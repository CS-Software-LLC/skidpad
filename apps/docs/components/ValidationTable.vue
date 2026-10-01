<script setup lang="ts">
import results from "../../../tools/validate/golden/results.json";

const rows = Object.entries(results.vehicles).map(([id, v]) => ({
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
  parks: Object.values(v.parked).every((c) => c === null || c.holds),
  creep: Math.max(...Object.values(v.parked).map((c) => (c === null ? 0 : c.creepSpeed))),
  sweepStable: v.timestepSweep.stable,
  sweepKus: v.timestepSweep.gradientSpreadDegPerG,
  sweepBrake: v.timestepSweep.brakingDistanceSpread,
  hash: v.scriptedDriveHash,
}));
const f = (v: number | null, d = 2) => (v === null ? "n/a" : v.toFixed(d));
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
          <code>{{ r.hash }}</code>
        </td>
      </tr>
    </tbody>
  </table>
</template>
