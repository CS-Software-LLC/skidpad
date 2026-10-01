/**
 * The raw WebAssembly export surface of `crates/cp-wasm` (ADR-0003).
 * Pointers are byte offsets into `memory`. Status codes: 0 = ok, negative =
 * error (see {@link ErrorCode}); call `cp_last_error_*` for the message.
 */
export interface CpExports {
  memory: WebAssembly.Memory;

  cp_alloc(len: number): number;
  cp_free(ptr: number, len: number): void;

  cp_abi_version(): number;
  cp_version_ptr(): number;
  cp_version_len(): number;
  cp_last_error_ptr(): number;
  cp_last_error_len(): number;
  cp_result_ptr(): number;
  cp_result_len(): number;
  cp_math_selftest(): bigint;
  cp_default_definition(): number;

  cp_input_stride(): number;
  cp_telemetry_stride(): number;
  cp_telemetry_layout_ptr(): number;
  cp_telemetry_layout_len(): number;

  cp_world_new(capacity: number): number;
  cp_world_free(handle: number): void;
  cp_world_add_vehicle(handle: number, jsonPtr: number, jsonLen: number): number;
  cp_world_set_definition(
    handle: number,
    vehicle: number,
    jsonPtr: number,
    jsonLen: number,
  ): number;
  cp_world_vehicle_count(handle: number): number;
  cp_world_capacity(handle: number): number;
  cp_world_inputs_ptr(handle: number): number;
  cp_world_telemetry_ptr(handle: number): number;
  cp_world_step(handle: number, dt: number): number;
  cp_world_step_count(handle: number): bigint;
  cp_world_state_hash(handle: number, vehicle: number): bigint;
  cp_world_hash(handle: number): bigint;
  cp_world_reset_vehicle(
    handle: number,
    vehicle: number,
    x: number,
    y: number,
    yaw: number,
  ): number;
  cp_world_snapshot_len(handle: number, vehicle: number): number;
  cp_world_snapshot(handle: number, vehicle: number, out: number, cap: number): number;
  cp_world_restore(handle: number, vehicle: number, ptr: number, len: number): number;

  cp_tire_new(jsonPtr: number, jsonLen: number): number;
  cp_tire_free(handle: number): void;
  cp_tire_out_stride(): number;
  cp_tire_eval(
    handle: number,
    fz: number,
    slipRatio: number,
    slipAngle: number,
    camber: number,
    vx: number,
    out: number,
  ): number;
  cp_tire_sweep(
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
  cp_tir_import(ptr: number, len: number): number;

  cp_run_scenario(ptr: number, len: number): number;
}

/** ABI version this loader was written against. */
export const EXPECTED_ABI_VERSION = 1;

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
}
