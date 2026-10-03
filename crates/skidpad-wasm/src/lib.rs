//! WebAssembly bindings for the Skidpad core (ADR-0003).
//!
//! A plain C-style ABI: integers, floats, and pointers into linear memory.
//! Everything that crosses the boundary is batched. Errors are reported as
//! status codes (`0` = ok, negative = error) with the message available
//! through `sp_last_error_ptr` / `sp_last_error_len`. JSON strings are used
//! for definitions and scenario requests because they are not in the hot path.
//!
//! The crate is single threaded (WASM has one thread); state lives in
//! thread-locals.

use skidpad_core::ai::AiConfig;
use skidpad_core::input::VehicleInput;
use skidpad_core::telemetry;
use skidpad_core::tire::{tir, TireInput, TireModel};
use skidpad_core::validation::{
    lane_change, parked, step_steer, straight_line, timestep_sweep, understeer, LaneChangeConfig,
    ParkedConfig, StepSteerConfig, StraightLineConfig, TimestepSweepConfig, UndersteerConfig,
};
use skidpad_core::vehicle::{HostMode, WHEEL_COUNT};
use skidpad_core::world::{Lod, WorldError};
use skidpad_core::world::{
    HOST_CONTACT_STRIDE, HOST_IN_BODY_LEN, HOST_IN_STRIDE, HOST_OUT_BODY_LEN, HOST_OUT_STRIDE,
    HOST_OUT_WHEEL_STRIDE, WHEEL_RAY_STRIDE,
};
use skidpad_core::{Surface, VehicleDefinition, World};
use std::cell::RefCell;

/// Bump this whenever an exported signature changes. The TypeScript loader
/// refuses to run against a different ABI version.
pub const ABI_VERSION: u32 = 6;

pub const OK: i32 = 0;
pub const ERR_INVALID_HANDLE: i32 = -1;
pub const ERR_INVALID_JSON: i32 = -2;
pub const ERR_INVALID_DEFINITION: i32 = -3;
pub const ERR_WORLD_FULL: i32 = -4;
pub const ERR_NO_SUCH_VEHICLE: i32 = -5;
pub const ERR_SNAPSHOT: i32 = -6;
pub const ERR_BUFFER_TOO_SMALL: i32 = -7;
pub const ERR_SCENARIO: i32 = -8;
pub const ERR_WRONG_MODEL: i32 = -9;

thread_local! {
    static WORLDS: RefCell<Vec<Option<World>>> = const { RefCell::new(Vec::new()) };
    static TIRES: RefCell<Vec<Option<TireModel>>> = const { RefCell::new(Vec::new()) };
    static LAST_ERROR: RefCell<String> = const { RefCell::new(String::new()) };
    static RESULT: RefCell<String> = const { RefCell::new(String::new()) };
    static LAYOUT: RefCell<String> = const { RefCell::new(String::new()) };
}

fn set_error(msg: impl Into<String>) {
    LAST_ERROR.with(|e| *e.borrow_mut() = msg.into());
}

fn set_result(s: String) {
    RESULT.with(|r| *r.borrow_mut() = s);
}

/// # Safety
/// `ptr` and `len` must describe a valid UTF-8 byte range in linear memory
/// that was written by the caller (typically via `sp_alloc`).
unsafe fn str_from(ptr: *const u8, len: usize) -> Result<&'static str, i32> {
    if ptr.is_null() {
        set_error("null pointer");
        return Err(ERR_INVALID_JSON);
    }
    let bytes = std::slice::from_raw_parts(ptr, len);
    std::str::from_utf8(bytes).map_err(|_| {
        set_error("input is not valid UTF-8");
        ERR_INVALID_JSON
    })
}

fn with_world<R>(handle: u32, f: impl FnOnce(&mut World) -> R) -> Result<R, i32> {
    WORLDS.with(|w| {
        let mut w = w.borrow_mut();
        match w.get_mut(handle as usize).and_then(|s| s.as_mut()) {
            Some(world) => Ok(f(world)),
            None => {
                set_error(format!("invalid world handle {handle}"));
                Err(ERR_INVALID_HANDLE)
            }
        }
    })
}

fn with_tire<R>(handle: u32, f: impl FnOnce(&TireModel) -> R) -> Result<R, i32> {
    TIRES.with(|t| {
        let t = t.borrow();
        match t.get(handle as usize).and_then(|s| s.as_ref()) {
            Some(tire) => Ok(f(tire)),
            None => {
                set_error(format!("invalid tire handle {handle}"));
                Err(ERR_INVALID_HANDLE)
            }
        }
    })
}

fn unwrap_code<T>(r: Result<T, i32>, ok: impl FnOnce(T) -> i32) -> i32 {
    match r {
        Ok(v) => ok(v),
        Err(code) => code,
    }
}

// ---------------------------------------------------------------- memory ----

/// Allocate `len` bytes in linear memory. Pair with `sp_free`.
#[no_mangle]
pub extern "C" fn sp_alloc(len: usize) -> *mut u8 {
    let mut v: Vec<u8> = Vec::with_capacity(len.max(1));
    let ptr = v.as_mut_ptr();
    std::mem::forget(v);
    ptr
}

/// Free memory from `sp_alloc`.
///
/// # Safety
/// `ptr` must come from `sp_alloc(len)` with the same `len`.
#[no_mangle]
pub unsafe extern "C" fn sp_free(ptr: *mut u8, len: usize) {
    if !ptr.is_null() {
        drop(Vec::from_raw_parts(ptr, 0, len.max(1)));
    }
}

// --------------------------------------------------------------- version ----

#[no_mangle]
pub extern "C" fn sp_abi_version() -> u32 {
    ABI_VERSION
}

/// The crate version, then `+` and the source hash when the build set one
/// (`0.1.0+0123456789abcdef`).
#[no_mangle]
pub extern "C" fn sp_version_ptr() -> *const u8 {
    skidpad_core::BUILD_VERSION.as_ptr()
}

#[no_mangle]
pub extern "C" fn sp_version_len() -> usize {
    skidpad_core::BUILD_VERSION.len()
}

#[no_mangle]
pub extern "C" fn sp_last_error_ptr() -> *const u8 {
    LAST_ERROR.with(|e| e.borrow().as_ptr())
}

#[no_mangle]
pub extern "C" fn sp_last_error_len() -> usize {
    LAST_ERROR.with(|e| e.borrow().len())
}

/// Pointer to the last JSON result (scenario runs, `.tir` imports).
#[no_mangle]
pub extern "C" fn sp_result_ptr() -> *const u8 {
    RESULT.with(|r| r.borrow().as_ptr())
}

#[no_mangle]
pub extern "C" fn sp_result_len() -> usize {
    RESULT.with(|r| r.borrow().len())
}

/// Hash of the deterministic math self-test (ADR-0006).
#[no_mangle]
pub extern "C" fn skidpad_math_selftest() -> u64 {
    skidpad_math::selftest_hash()
}

// ---------------------------------------------------------------- layout ----

#[no_mangle]
pub extern "C" fn sp_input_stride() -> u32 {
    VehicleInput::STRIDE as u32
}

#[no_mangle]
pub extern "C" fn sp_telemetry_stride() -> u32 {
    telemetry::STRIDE as u32
}

/// JSON array of `{name, unit}` describing each telemetry slot.
#[no_mangle]
pub extern "C" fn sp_telemetry_layout_ptr() -> *const u8 {
    LAYOUT.with(|l| {
        let mut l = l.borrow_mut();
        if l.is_empty() {
            *l = telemetry::layout_json();
        }
        l.as_ptr()
    })
}

#[no_mangle]
pub extern "C" fn sp_telemetry_layout_len() -> usize {
    LAYOUT.with(|l| {
        let mut l = l.borrow_mut();
        if l.is_empty() {
            *l = telemetry::layout_json();
        }
        l.len()
    })
}

#[no_mangle]
pub extern "C" fn sp_wheel_count() -> u32 {
    WHEEL_COUNT as u32
}

/// Host-sync input record length per vehicle (see `skidpad_core::world`).
#[no_mangle]
pub extern "C" fn sp_host_in_stride() -> u32 {
    HOST_IN_STRIDE as u32
}

#[no_mangle]
pub extern "C" fn sp_host_in_body_len() -> u32 {
    HOST_IN_BODY_LEN as u32
}

#[no_mangle]
pub extern "C" fn sp_host_contact_stride() -> u32 {
    HOST_CONTACT_STRIDE as u32
}

#[no_mangle]
pub extern "C" fn sp_host_out_stride() -> u32 {
    HOST_OUT_STRIDE as u32
}

#[no_mangle]
pub extern "C" fn sp_host_out_body_len() -> u32 {
    HOST_OUT_BODY_LEN as u32
}

#[no_mangle]
pub extern "C" fn sp_host_out_wheel_stride() -> u32 {
    HOST_OUT_WHEEL_STRIDE as u32
}

#[no_mangle]
pub extern "C" fn sp_wheel_ray_stride() -> u32 {
    WHEEL_RAY_STRIDE as u32
}

// ----------------------------------------------------------------- world ----

#[no_mangle]
pub extern "C" fn sp_world_new(capacity: u32) -> u32 {
    WORLDS.with(|w| {
        let mut w = w.borrow_mut();
        let world = World::new(capacity as usize);
        if let Some(i) = w.iter().position(|s| s.is_none()) {
            w[i] = Some(world);
            i as u32
        } else {
            w.push(Some(world));
            (w.len() - 1) as u32
        }
    })
}

#[no_mangle]
pub extern "C" fn sp_world_free(handle: u32) {
    WORLDS.with(|w| {
        let mut w = w.borrow_mut();
        if let Some(slot) = w.get_mut(handle as usize) {
            *slot = None;
        }
    });
}

/// Add a vehicle from a JSON definition. Returns the vehicle index or a
/// negative error code.
///
/// # Safety
/// See `str_from`.
#[no_mangle]
pub unsafe extern "C" fn sp_world_add_vehicle(
    handle: u32,
    json_ptr: *const u8,
    json_len: usize,
) -> i32 {
    let json = match str_from(json_ptr, json_len) {
        Ok(s) => s,
        Err(c) => return c,
    };
    let def: VehicleDefinition = match serde_json::from_str(json) {
        Ok(d) => d,
        Err(e) => {
            set_error(format!("definition is not valid JSON for this format: {e}"));
            return ERR_INVALID_JSON;
        }
    };
    unwrap_code(with_world(handle, |w| w.add_vehicle(def)), |r| match r {
        Ok(i) => i as i32,
        Err(e) => world_error_code(e),
    })
}

/// Replace a vehicle's definition in place (live tuning).
///
/// # Safety
/// See `str_from`.
#[no_mangle]
pub unsafe extern "C" fn sp_world_set_definition(
    handle: u32,
    vehicle: u32,
    json_ptr: *const u8,
    json_len: usize,
) -> i32 {
    let json = match str_from(json_ptr, json_len) {
        Ok(s) => s,
        Err(c) => return c,
    };
    let def: VehicleDefinition = match serde_json::from_str(json) {
        Ok(d) => d,
        Err(e) => {
            set_error(format!("definition is not valid JSON for this format: {e}"));
            return ERR_INVALID_JSON;
        }
    };
    unwrap_code(
        with_world(handle, |w| w.set_definition(vehicle as usize, def)),
        |r| match r {
            Ok(()) => OK,
            Err(e) => world_error_code(e),
        },
    )
}

#[no_mangle]
pub extern "C" fn sp_world_vehicle_count(handle: u32) -> i32 {
    unwrap_code(with_world(handle, |w| w.len() as i32), |n| n)
}

#[no_mangle]
pub extern "C" fn sp_world_capacity(handle: u32) -> i32 {
    unwrap_code(with_world(handle, |w| w.capacity() as i32), |n| n)
}

/// Pointer to the input buffer: `capacity × sp_input_stride()` f64 values.
#[no_mangle]
pub extern "C" fn sp_world_inputs_ptr(handle: u32) -> *mut f64 {
    with_world(handle, |w| w.inputs_mut().as_mut_ptr()).unwrap_or(std::ptr::null_mut())
}

/// Pointer to the telemetry buffer: `capacity × sp_telemetry_stride()` f64 values.
#[no_mangle]
pub extern "C" fn sp_world_telemetry_ptr(handle: u32) -> *const f64 {
    with_world(handle, |w| w.telemetry().as_ptr()).unwrap_or(std::ptr::null())
}

/// Pointer to the host-sync input buffer: `capacity × sp_host_in_stride()`
/// f64 values. An external host writes body state and wheel contacts here
/// before each step (ADR-0002).
#[no_mangle]
pub extern "C" fn sp_world_host_in_ptr(handle: u32) -> *mut f64 {
    with_world(handle, |w| w.host_in_mut().as_mut_ptr()).unwrap_or(std::ptr::null_mut())
}

/// Pointer to the host-sync output buffer: `capacity × sp_host_out_stride()`
/// f64 values with the impulses to apply after each step.
#[no_mangle]
pub extern "C" fn sp_world_host_out_ptr(handle: u32) -> *const f64 {
    with_world(handle, |w| w.host_out().as_ptr()).unwrap_or(std::ptr::null())
}

/// Switch a vehicle between the built-in host (`0`) and an external host
/// (`1`). Only the four-wheel model supports an external host.
#[no_mangle]
pub extern "C" fn sp_world_set_host_mode(handle: u32, vehicle: u32, mode: u32) -> i32 {
    let mode = if mode == 0 {
        HostMode::Builtin
    } else {
        HostMode::External
    };
    unwrap_code(
        with_world(handle, |w| w.set_host_mode(vehicle as usize, mode)),
        |r| match r {
            Ok(()) => OK,
            Err(e) => world_error_code(e),
        },
    )
}

/// Write the wheel rays (body frame, `sp_wheel_count() × sp_wheel_ray_stride()`
/// values) into `out`. Returns the number of values written.
///
/// # Safety
/// `out` must point to at least `cap` writable f64 values.
#[no_mangle]
pub unsafe extern "C" fn sp_world_wheel_rays(
    handle: u32,
    vehicle: u32,
    out: *mut f64,
    cap: usize,
) -> i32 {
    if out.is_null() {
        set_error("null output buffer");
        return ERR_BUFFER_TOO_SMALL;
    }
    let need = WHEEL_COUNT * WHEEL_RAY_STRIDE;
    if cap < need {
        set_error(format!("wheel rays need {need} values, buffer holds {cap}"));
        return ERR_BUFFER_TOO_SMALL;
    }
    let buf = std::slice::from_raw_parts_mut(out, cap);
    unwrap_code(
        with_world(handle, |w| w.wheel_rays(vehicle as usize, buf)),
        |r| match r {
            Ok(n) => n as i32,
            Err(e) => world_error_code(e),
        },
    )
}

#[no_mangle]
pub extern "C" fn sp_world_step(handle: u32, dt: f64) -> i32 {
    unwrap_code(with_world(handle, |w| w.step(dt)), |_| OK)
}

/// Map a world error to its status code, recording the message.
fn world_error_code(e: WorldError) -> i32 {
    let code = match &e {
        WorldError::Full { .. } => ERR_WORLD_FULL,
        WorldError::Invalid(_) => ERR_INVALID_DEFINITION,
        WorldError::NoSuchVehicle(_) => ERR_NO_SUCH_VEHICLE,
        WorldError::Snapshot(_) => ERR_SNAPSHOT,
        WorldError::WrongModel(_) => ERR_WRONG_MODEL,
    };
    set_error(e.to_string());
    code
}

/// Take `count` host steps of `dt` in one call (batched stepping);
/// identical to `count` calls of `sp_world_step`.
#[no_mangle]
pub extern "C" fn sp_world_step_many(handle: u32, dt: f64, count: u32) -> i32 {
    unwrap_code(with_world(handle, |w| w.step_many(dt, count)), |_| OK)
}

/// Set a vehicle's level of detail (ADR-0019): `0` full, `1` single-track,
/// `2` frozen. `substep_rate_hz` overrides the definition's substep rate at
/// this level; `0` keeps it.
#[no_mangle]
pub extern "C" fn sp_world_set_lod(
    handle: u32,
    vehicle: u32,
    lod: u32,
    substep_rate_hz: f64,
) -> i32 {
    let Some(lod) = Lod::from_u32(lod) else {
        set_error("unknown level of detail");
        return ERR_INVALID_DEFINITION;
    };
    unwrap_code(
        with_world(handle, |w| {
            w.set_lod(vehicle as usize, lod, substep_rate_hz)
        }),
        |r| match r {
            Ok(()) => OK,
            Err(e) => world_error_code(e),
        },
    )
}

/// A vehicle's level of detail (`0`, `1`, `2`) or a negative error code.
#[no_mangle]
pub extern "C" fn sp_world_lod(handle: u32, vehicle: u32) -> i32 {
    unwrap_code(
        with_world(handle, |w| w.lod(vehicle as usize)),
        |r| match r {
            Ok(l) => l.as_u32() as i32,
            Err(e) => world_error_code(e),
        },
    )
}

/// Hand a vehicle to the path-following driver (ADR-0020). The path is
/// `n` f64 values `[x0, y0, x1, y1, …]`; the config is `cfg_len` f64
/// values in the order of `AiConfig::from_values`, NaN for a default.
///
/// # Safety
/// `points` must point to `n` readable f64 values and `cfg` to `cfg_len`.
#[no_mangle]
pub unsafe extern "C" fn sp_world_set_ai(
    handle: u32,
    vehicle: u32,
    points: *const f64,
    n: usize,
    cfg: *const f64,
    cfg_len: usize,
) -> i32 {
    if (points.is_null() && n > 0) || (cfg.is_null() && cfg_len > 0) {
        set_error("null driver buffer");
        return ERR_INVALID_DEFINITION;
    }
    let path: &[f64] = if n == 0 {
        &[]
    } else {
        std::slice::from_raw_parts(points, n)
    };
    let cfg = AiConfig::from_values(if cfg_len == 0 {
        &[]
    } else {
        std::slice::from_raw_parts(cfg, cfg_len)
    });
    unwrap_code(
        with_world(handle, |w| w.set_ai(vehicle as usize, path, cfg)),
        |r| match r {
            Ok(()) => OK,
            Err(e) => world_error_code(e),
        },
    )
}

#[no_mangle]
pub extern "C" fn sp_world_clear_ai(handle: u32, vehicle: u32) -> i32 {
    unwrap_code(
        with_world(handle, |w| w.clear_ai(vehicle as usize)),
        |r| match r {
            Ok(()) => OK,
            Err(e) => world_error_code(e),
        },
    )
}

/// Number of values `sp_world_ai_status` writes.
pub const AI_STATUS_LEN: usize = 5;

/// Write the driver's status, `[distance, laps, lateralError, targetSpeed,
/// finished]`, into `out`. Returns the number of values written: 5, or 0
/// when the vehicle has no driver.
///
/// # Safety
/// `out` must point to at least `cap` writable f64 values.
#[no_mangle]
pub unsafe extern "C" fn sp_world_ai_status(
    handle: u32,
    vehicle: u32,
    out: *mut f64,
    cap: usize,
) -> i32 {
    if out.is_null() || cap < AI_STATUS_LEN {
        set_error("driver status needs 5 values");
        return ERR_BUFFER_TOO_SMALL;
    }
    let buf = std::slice::from_raw_parts_mut(out, cap);
    unwrap_code(
        with_world(handle, |w| w.ai_status(vehicle as usize)),
        |r| match r {
            Ok(Some(st)) => {
                buf[0] = st.distance;
                buf[1] = st.laps as f64;
                buf[2] = st.lateral_error;
                buf[3] = st.target_speed;
                buf[4] = if st.finished { 1.0 } else { 0.0 };
                AI_STATUS_LEN as i32
            }
            Ok(None) => 0,
            Err(e) => world_error_code(e),
        },
    )
}

#[no_mangle]
pub extern "C" fn sp_world_step_count(handle: u32) -> u64 {
    with_world(handle, |w| w.step_count).unwrap_or(0)
}

#[no_mangle]
pub extern "C" fn sp_world_state_hash(handle: u32, vehicle: u32) -> u64 {
    with_world(handle, |w| w.state_hash(vehicle as usize).unwrap_or(0)).unwrap_or(0)
}

#[no_mangle]
pub extern "C" fn sp_world_hash(handle: u32) -> u64 {
    with_world(handle, |w| w.world_hash()).unwrap_or(0)
}

/// Ground slope of the built-in flat world under a vehicle: rise per metre
/// along world +x (grade) and +y (cross slope). Ignored by an external host.
#[no_mangle]
pub extern "C" fn sp_world_set_ground_slope(
    handle: u32,
    vehicle: u32,
    grade: f64,
    cross: f64,
) -> i32 {
    unwrap_code(
        with_world(handle, |w| {
            w.set_ground_slope(vehicle as usize, grade, cross)
        }),
        |r| match r {
            Ok(()) => OK,
            Err(e) => world_error_code(e),
        },
    )
}

/// Replace a world's surface table from a JSON array of
/// `{"grip", "rollingResistance", "drag"}` objects; entry `i` is the surface
/// id `i` that wheel contacts carry (ADR-0014).
///
/// # Safety
/// See `str_from`.
#[no_mangle]
pub unsafe extern "C" fn sp_world_set_surfaces(
    handle: u32,
    json_ptr: *const u8,
    json_len: usize,
) -> i32 {
    let json = match str_from(json_ptr, json_len) {
        Ok(s) => s,
        Err(c) => return c,
    };
    let list: Vec<Surface> = match serde_json::from_str(json) {
        Ok(l) => l,
        Err(e) => {
            set_error(format!(
                "surface table is not valid JSON for this format: {e}"
            ));
            return ERR_INVALID_JSON;
        }
    };
    unwrap_code(with_world(handle, |w| w.set_surfaces(&list)), |r| match r {
        Ok(()) => OK,
        Err(e) => world_error_code(e),
    })
}

/// Set a world's host step counter (restoring a whole world).
#[no_mangle]
pub extern "C" fn sp_world_set_step_count(handle: u32, count: f64) -> i32 {
    if !(0.0..=9.007_199_254_740_991e15).contains(&count) || count != count.trunc() {
        set_error("step count must be a whole number from 0 to 2^53 - 1");
        return ERR_INVALID_DEFINITION;
    }
    unwrap_code(
        with_world(handle, |w| w.set_step_count(count as u64)),
        |()| OK,
    )
}

/// Surface id of the built-in flat ground under one wheel of a vehicle
/// (0 … 3: FL, FR, RL, RR), or under all of them for any larger `wheel`.
/// An external host tags each wheel contact itself through the host-sync
/// record.
#[no_mangle]
pub extern "C" fn sp_world_set_surface(handle: u32, vehicle: u32, wheel: u32, surface: u32) -> i32 {
    unwrap_code(
        with_world(handle, |w| {
            if (wheel as usize) < WHEEL_COUNT {
                w.set_wheel_surface(vehicle as usize, wheel as usize, surface)
            } else {
                w.set_surface(vehicle as usize, surface)
            }
        }),
        |r| match r {
            Ok(()) => OK,
            Err(e) => world_error_code(e),
        },
    )
}

/// Reset a vehicle at `(x, y)` facing `yaw`, or along `(dx, dy)` when that
/// is not the zero vector.
#[no_mangle]
pub extern "C" fn sp_world_reset_vehicle(
    handle: u32,
    vehicle: u32,
    x: f64,
    y: f64,
    yaw: f64,
    dx: f64,
    dy: f64,
) -> i32 {
    unwrap_code(
        with_world(handle, |w| {
            if dx == 0.0 && dy == 0.0 {
                w.reset_vehicle(vehicle as usize, x, y, yaw)
            } else {
                w.reset_vehicle_heading(vehicle as usize, x, y, dx, dy)
            }
        }),
        |r| match r {
            Ok(()) => OK,
            Err(e) => world_error_code(e),
        },
    )
}

#[no_mangle]
pub extern "C" fn sp_world_snapshot_len(handle: u32, vehicle: u32) -> i32 {
    unwrap_code(
        with_world(handle, |w| w.snapshot_len(vehicle as usize)),
        |r| match r {
            Ok(n) => n as i32,
            Err(e) => world_error_code(e),
        },
    )
}

/// Write a snapshot into `out`. Returns bytes written, `ERR_BUFFER_TOO_SMALL`
/// if `cap` is too small (call `sp_world_snapshot_len` first).
///
/// # Safety
/// `out` must point to at least `cap` writable bytes.
#[no_mangle]
pub unsafe extern "C" fn sp_world_snapshot(
    handle: u32,
    vehicle: u32,
    out: *mut u8,
    cap: usize,
) -> i32 {
    if out.is_null() {
        set_error("null output buffer");
        return ERR_BUFFER_TOO_SMALL;
    }
    let buf = std::slice::from_raw_parts_mut(out, cap);
    unwrap_code(
        with_world(handle, |w| w.snapshot(vehicle as usize, buf)),
        |r| match r {
            Ok(n) if n <= cap => n as i32,
            Ok(n) => {
                set_error(format!("snapshot needs {n} bytes, buffer holds {cap}"));
                ERR_BUFFER_TOO_SMALL
            }
            Err(e) => world_error_code(e),
        },
    )
}

/// # Safety
/// `ptr` must point to `len` readable bytes.
#[no_mangle]
pub unsafe extern "C" fn sp_world_restore(
    handle: u32,
    vehicle: u32,
    ptr: *const u8,
    len: usize,
) -> i32 {
    if ptr.is_null() {
        set_error("null snapshot buffer");
        return ERR_SNAPSHOT;
    }
    let bytes = std::slice::from_raw_parts(ptr, len);
    unwrap_code(
        with_world(handle, |w| w.restore(vehicle as usize, bytes)),
        |r| match r {
            Ok(()) => OK,
            Err(e) => world_error_code(e),
        },
    )
}

// ------------------------------------------------------------------ tire ----

/// Create a standalone tire model from JSON (`{"model":"feel",...}` or
/// `{"model":"magicFormula",...}`). Returns a handle or a negative code.
///
/// # Safety
/// See `str_from`.
#[no_mangle]
pub unsafe extern "C" fn sp_tire_new(json_ptr: *const u8, json_len: usize) -> i32 {
    let json = match str_from(json_ptr, json_len) {
        Ok(s) => s,
        Err(c) => return c,
    };
    let model: TireModel = match serde_json::from_str(json) {
        Ok(m) => m,
        Err(e) => {
            set_error(format!(
                "tire definition is not valid JSON for this format: {e}"
            ));
            return ERR_INVALID_JSON;
        }
    };
    let mut errors = Vec::new();
    model.validate("tire", &mut errors);
    if !errors.is_empty() {
        set_error(errors.join("; "));
        return ERR_INVALID_DEFINITION;
    }
    TIRES.with(|t| {
        let mut t = t.borrow_mut();
        if let Some(i) = t.iter().position(|s| s.is_none()) {
            t[i] = Some(model);
            i as i32
        } else {
            t.push(Some(model));
            (t.len() - 1) as i32
        }
    })
}

#[no_mangle]
pub extern "C" fn sp_tire_free(handle: u32) {
    TIRES.with(|t| {
        let mut t = t.borrow_mut();
        if let Some(slot) = t.get_mut(handle as usize) {
            *slot = None;
        }
    });
}

/// Number of f64 values `sp_tire_eval` writes per sample.
pub const TIRE_OUT_STRIDE: usize = 8;

#[no_mangle]
pub extern "C" fn sp_tire_out_stride() -> u32 {
    TIRE_OUT_STRIDE as u32
}

fn write_tire_out(o: &skidpad_core::TireOutput, out: &mut [f64]) {
    out[0] = o.fx;
    out[1] = o.fy;
    out[2] = o.mz;
    out[3] = o.mx;
    out[4] = o.my;
    out[5] = o.trail;
    out[6] = o.fx_max;
    out[7] = o.fy_max;
}

/// Evaluate one tire sample. Writes `TIRE_OUT_STRIDE` values to `out`.
///
/// # Safety
/// `out` must point to at least `TIRE_OUT_STRIDE` writable f64 values.
#[no_mangle]
pub unsafe extern "C" fn sp_tire_eval(
    handle: u32,
    fz: f64,
    slip_ratio: f64,
    slip_angle: f64,
    camber: f64,
    vx: f64,
    out: *mut f64,
) -> i32 {
    if out.is_null() {
        return ERR_BUFFER_TOO_SMALL;
    }
    let out = std::slice::from_raw_parts_mut(out, TIRE_OUT_STRIDE);
    unwrap_code(
        with_tire(handle, |t| {
            let o = t.eval(&TireInput {
                fz,
                slip_ratio,
                slip_angle,
                camber,
                vx,
                ..TireInput::default()
            });
            write_tire_out(&o, out);
        }),
        |_| OK,
    )
}

/// Batched curve sweep for explorers and plots. Sweeps `n` samples of one slip
/// axis from `from` to `to` while holding the other slip fixed. `axis` is 0
/// for slip ratio, 1 for slip angle. Writes `n × TIRE_OUT_STRIDE` values.
///
/// # Safety
/// `out` must point to at least `n × TIRE_OUT_STRIDE` writable f64 values.
#[no_mangle]
#[allow(clippy::too_many_arguments)]
pub unsafe extern "C" fn sp_tire_sweep(
    handle: u32,
    axis: u32,
    from: f64,
    to: f64,
    n: u32,
    fz: f64,
    other_slip: f64,
    camber: f64,
    out: *mut f64,
) -> i32 {
    if out.is_null() || n == 0 {
        return ERR_BUFFER_TOO_SMALL;
    }
    let n = n as usize;
    let out = std::slice::from_raw_parts_mut(out, n * TIRE_OUT_STRIDE);
    unwrap_code(
        with_tire(handle, |t| {
            for i in 0..n {
                let s = if n > 1 {
                    from + (to - from) * (i as f64) / ((n - 1) as f64)
                } else {
                    from
                };
                let input = if axis == 0 {
                    TireInput {
                        fz,
                        slip_ratio: s,
                        slip_angle: other_slip,
                        camber,
                        vx: 10.0,
                        ..TireInput::default()
                    }
                } else {
                    TireInput {
                        fz,
                        slip_ratio: other_slip,
                        slip_angle: s,
                        camber,
                        vx: 10.0,
                        ..TireInput::default()
                    }
                };
                let o = t.eval(&input);
                write_tire_out(&o, &mut out[i * TIRE_OUT_STRIDE..(i + 1) * TIRE_OUT_STRIDE]);
            }
        }),
        |_| OK,
    )
}

/// Parse a `.tir` file. On success the result JSON
/// (`{"params": {...}, "warnings": [...]}`) is available via `sp_result_*`.
///
/// # Safety
/// See `str_from`.
#[no_mangle]
pub unsafe extern "C" fn sp_tir_import(ptr: *const u8, len: usize) -> i32 {
    let text = match str_from(ptr, len) {
        Ok(s) => s,
        Err(c) => return c,
    };
    let imp = tir::import_str(text);
    match serde_json::to_string(&imp) {
        Ok(s) => {
            set_result(s);
            OK
        }
        Err(e) => {
            set_error(e.to_string());
            ERR_INVALID_JSON
        }
    }
}

// -------------------------------------------------------------- scenarios ----

#[derive(serde::Deserialize)]
#[serde(tag = "scenario", rename_all = "camelCase")]
enum ScenarioRequest {
    UndersteerGradient {
        definition: VehicleDefinition,
        #[serde(default)]
        config: UndersteerConfig,
    },
    StraightLine {
        definition: VehicleDefinition,
        #[serde(default)]
        config: StraightLineConfig,
    },
    ParkedOnSlope {
        definition: VehicleDefinition,
        #[serde(default)]
        config: ParkedConfig,
    },
    TimestepSweep {
        definition: VehicleDefinition,
        #[serde(default)]
        config: TimestepSweepConfig,
    },
    StepSteer {
        definition: VehicleDefinition,
        #[serde(default)]
        config: StepSteerConfig,
    },
    DoubleLaneChange {
        definition: VehicleDefinition,
        #[serde(default)]
        config: LaneChangeConfig,
    },
}

/// Run a validation scenario described by JSON. The result JSON is available
/// via `sp_result_*`.
///
/// # Safety
/// See `str_from`.
#[no_mangle]
pub unsafe extern "C" fn sp_run_scenario(ptr: *const u8, len: usize) -> i32 {
    let text = match str_from(ptr, len) {
        Ok(s) => s,
        Err(c) => return c,
    };
    let req: ScenarioRequest = match serde_json::from_str(text) {
        Ok(r) => r,
        Err(e) => {
            set_error(format!("scenario request is not valid: {e}"));
            return ERR_INVALID_JSON;
        }
    };
    let result = match req {
        ScenarioRequest::UndersteerGradient { definition, config } => {
            understeer::run(&definition, &config).map(|r| serde_json::to_string(&r))
        }
        ScenarioRequest::StraightLine { definition, config } => {
            straight_line::run(&definition, &config).map(|r| serde_json::to_string(&r))
        }
        ScenarioRequest::ParkedOnSlope { definition, config } => {
            parked::run(&definition, &config).map(|r| serde_json::to_string(&r))
        }
        ScenarioRequest::TimestepSweep { definition, config } => {
            timestep_sweep::run(&definition, &config).map(|r| serde_json::to_string(&r))
        }
        ScenarioRequest::StepSteer { definition, config } => {
            step_steer::run(&definition, &config).map(|r| serde_json::to_string(&r))
        }
        ScenarioRequest::DoubleLaneChange { definition, config } => {
            lane_change::run(&definition, &config).map(|r| serde_json::to_string(&r))
        }
    };
    match result {
        Ok(Ok(json)) => {
            set_result(json);
            OK
        }
        Ok(Err(e)) => {
            set_error(e.to_string());
            ERR_INVALID_JSON
        }
        Err(e) => {
            set_error(e);
            ERR_SCENARIO
        }
    }
}

/// Write the default vehicle definition as JSON to the result buffer, so the
/// TypeScript layer never duplicates the defaults; with a (partial)
/// definition, that definition completed with the defaults, as
/// `sp_world_add_vehicle` would read it.
///
/// # Safety
/// See `str_from`.
#[no_mangle]
pub unsafe extern "C" fn sp_default_definition(json_ptr: *const u8, json_len: usize) -> i32 {
    let def = if json_len == 0 {
        VehicleDefinition::default()
    } else {
        let json = match str_from(json_ptr, json_len) {
            Ok(s) => s,
            Err(c) => return c,
        };
        match serde_json::from_str(json) {
            Ok(d) => d,
            Err(e) => {
                set_error(format!("definition is not valid JSON for this format: {e}"));
                return ERR_INVALID_JSON;
            }
        }
    };
    match serde_json::to_string(&def) {
        Ok(s) => {
            set_result(s);
            OK
        }
        Err(e) => {
            set_error(e.to_string());
            ERR_INVALID_JSON
        }
    }
}
