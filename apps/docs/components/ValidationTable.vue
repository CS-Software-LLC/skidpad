<script setup lang="ts">
import results from "../../../tools/validate/golden/results.json";

// The milestone 6 keys (`stepSteer`, `laneChange`, `surfaces`) are read with
// optional chaining so the page builds against a golden file that predates
// them; the cells then read "n/a".
type Any = Record<string, any>;

const rows = Object.entries(results.vehicles as Record<string, Any>).map(([id, v]) => ({
  id,
  kus: v.understeer.gradientDegPerG,
  kusSingle: v.understeerSingleTrack.gradientDegPerG,
  kusLin: v.understeer.analyticGradientDegPerG,
  accel: v.straightLine.accelTime,
  brake: v.straightLine.brakingDistance,
  brakeAbs: v.straightLine.brakingDistanceAbs,
  decel: v.straightLine.meanDeceleration,
  locked: v.straightLine.wheelLocked,
  lockTime: v.straightLine.lockTime,
  chatter: v.straightLine.lockReleases > 0,
  ripple: v.straightLine.lockedDecelRipple,
  settled: v.straightLine.settledSpeed,
  parks: Object.values(v.parked as Record<string, Any | null>).every((c) => c === null || c.holds),
  creep: Math.max(
    ...Object.values(v.parked as Record<string, Any | null>).map((c) =>
      c === null ? 0 : c.creepSpeed,
    ),
  ),
  sweepStable: v.timestepSweep.stable,
  sweepKus: v.timestepSweep.gradientSpreadDegPerG,
  sweepBrake: v.timestepSweep.brakingDistanceSpread,
  stepResponse: (v.stepSteer?.yawRateResponseTime ?? null) as number | null,
  stepOvershoot: (v.stepSteer?.yawRateOvershoot ?? null) as number | null,
  lanePass: (v.laneChange?.maxPassingSpeed ?? null) as number | null,
  laneRun: v.laneChange !== undefined,
  iceBrake: (v.surfaces?.ice?.brakingDistance ?? null) as number | null,
  iceBrakeAbs: (v.surfaces?.ice?.brakingDistanceAbs ?? null) as number | null,
  iceSpun: (v.surfaces?.ice?.spun ?? false) as boolean,
  hash: v.scriptedDriveHash,
}));
const f = (v: number | null | undefined, d = 2) => (v == null ? "n/a" : v.toFixed(d));
const kmh = (v: number) => (3.6 * v).toFixed(0);
</script>

<template>
  <p>
    <small
      >Core {{ results.coreVersion }} · math self-test hash
      <code>{{ results.mathSelftestHash }}</code></small
    >
  </p>
  <table>
    <thead>
      <tr>
        <th>Vehicle</th>
        <th>K<sub>us</sub> four-wheel (deg/g)</th>
        <th>K<sub>us</sub> single-track (deg/g)</th>
        <th>K<sub>us</sub> linear theory (deg/g)</th>
        <th>0–100 km/h (s)</th>
        <th>100–0 km/h (m), locked / ABS</th>
        <th>Mean decel (m/s²)</th>
        <th>Wheels lock</th>
        <th>Parks on slopes</th>
        <th>Timestep sweep</th>
        <th>Step steer: yaw-rate response (s) / overshoot (%)</th>
        <th>Lane change passes up to (km/h)</th>
        <th>100–0 km/h on ice (m), locked / ABS</th>
        <th>Scripted drive hash</th>
      </tr>
    </thead>
    <tbody>
      <tr v-for="r in rows" :key="r.id">
        <td>{{ r.id }}</td>
        <td>{{ f(r.kus) }}</td>
        <td>{{ f(r.kusSingle) }}</td>
        <td>{{ f(r.kusLin) }}</td>
        <td>{{ f(r.accel) }}</td>
        <td>{{ f(r.brake, 1) }} / {{ f(r.brakeAbs, 1) }}</td>
        <td>{{ f(r.decel) }}</td>
        <td>
          {{ r.locked ? `at ${f(r.lockTime)} s` : "no" }}
          <template v-if="r.locked">
            , {{ r.chatter ? "chatter" : "no chatter" }}, ripple
            {{ (100 * r.ripple).toFixed(1) }} %, at rest after the stop ({{
              r.settled.toExponential(0)
            }}
            m/s)
          </template>
        </td>
        <td>{{ r.parks ? "yes" : "no" }} (worst creep {{ r.creep.toExponential(1) }} m/s)</td>
        <td>
          {{ r.sweepStable ? "stable" : "unstable" }} (K<sub>us</sub> ±{{
            r.sweepKus.toFixed(3)
          }}
          deg/g, braking ±{{ (100 * r.sweepBrake).toFixed(1) }} %)
        </td>
        <td>
          {{ f(r.stepResponse) }} /
          {{ r.stepOvershoot == null ? "n/a" : (100 * r.stepOvershoot).toFixed(1) }}
        </td>
        <td>{{ r.lanePass != null ? kmh(r.lanePass) : r.laneRun ? "none" : "n/a" }}</td>
        <td>
          <template v-if="r.iceSpun"
            >spins ({{ f(r.iceBrake, 0) }} / {{ f(r.iceBrakeAbs, 0) }})</template
          >
          <template v-else>{{ f(r.iceBrake, 0) }} / {{ f(r.iceBrakeAbs, 0) }}</template>
        </td>
        <td>
          <code>{{ r.hash }}</code>
        </td>
      </tr>
    </tbody>
  </table>
</template>
