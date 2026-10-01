/**
 * The raw WebAssembly export surface of `crates/skidpad-wasm` (ADR-0003).
 * Pointers are byte offsets into `memory`. Status codes: 0 = ok, negative =
 * error (see {@link ErrorCode}); call `sp_last_error_*` for the message.
 */
export interface CpExports {
  memory: WebAssembly.Memory;

  sp_alloc(len: number): number;
  sp_free(ptr: number, len: number): void;

  sp_abi_version(): number;
  sp_version_ptr(): number;
  sp_version_len(): number;
  sp_last_error_ptr(): number;
  sp_last_error_len(): number;
  sp_result_ptr(): number;
  sp_result_len(): number;
  skidpad_math_selftest(): bigint;
  sp_default_definition(): number;

  sp_input_stride(): number;
  sp_telemetry_stride(): number;
  sp_telemetry_layout_ptr(): number;
  sp_telemetry_layout_len(): number;
  sp_wheel_count(): number;
  sp_host_in_stride(): number;
  sp_host_in_body_len(): number;
  sp_host_contact_stride(): number;
  sp_host_out_stride(): number;
  sp_host_out_body_len(): number;
  sp_host_out_wheel_stride(): number;
  sp_wheel_ray_stride(): number;

  sp_world_new(capacity: number): number;
  sp_world_free(handle: number): void;
  sp_world_add_vehicle(handle: number, jsonPtr: number, jsonLen: number): number;
  sp_world_set_definition(
    handle: number,
    vehicle: number,
    jsonPtr: number,
    jsonLen: number,
  ): number;
  sp_world_vehicle_count(handle: number): number;
  sp_world_capacity(handle: number): number;
  sp_world_inputs_ptr(handle: number): number;
  sp_world_telemetry_ptr(handle: number): number;
  sp_world_host_in_ptr(handle: number): number;
  sp_world_host_out_ptr(handle: number): number;
  sp_world_set_host_mode(handle: number, vehicle: number, mode: number): number;
  sp_world_set_ground_slope(handle: number, vehicle: number, grade: number, cross: number): number;
  sp_world_wheel_rays(handle: number, vehicle: number, out: number, cap: number): number;
  sp_world_step(handle: number, dt: number): number;
  sp_world_step_count(handle: number): bigint;
  sp_world_state_hash(handle: number, vehicle: number): bigint;
  sp_world_hash(handle: number): bigint;
  sp_world_reset_vehicle(
    handle: number,
    vehicle: number,
    x: number,
    y: number,
    yaw: number,
  ): number;
  sp_world_snapshot_len(handle: number, vehicle: number): number;
  sp_world_snapshot(handle: number, vehicle: number, out: number, cap: number): number;
  sp_world_restore(handle: number, vehicle: number, ptr: number, len: number): number;

  sp_tire_new(jsonPtr: number, jsonLen: number): number;
  sp_tire_free(handle: number): void;
  sp_tire_out_stride(): number;
  sp_tire_eval(
    handle: number,
    fz: number,
    slipRatio: number,
    slipAngle: number,
    camber: number,
    vx: number,
    out: number,
  ): number;
  sp_tire_sweep(
    handle: number,
    axis: number,
    from: number,
    to: number,
    n: number,
    fz: number,
    otherSlip: number,
    camber: number,
    out: number,
  ): number;
  sp_tir_import(ptr: number, len: number): number;

  sp_run_scenario(ptr: number, len: number): number;
}

/** ABI version this loader was written against. */
export const EXPECTED_ABI_VERSION = 2;

export enum ErrorCode {
  Ok = 0,
  InvalidHandle = -1,
  InvalidJson = -2,
  InvalidDefinition = -3,
  WorldFull = -4,
  NoSuchVehicle = -5,
  Snapshot = -6,
  BufferTooSmall = -7,
  Scenario = -8,
  WrongModel = -9,
}
