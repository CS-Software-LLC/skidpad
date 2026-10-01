<script setup lang="ts">
import results from "../../../tools/validate/golden/results.json";

const rows = Object.entries(results.vehicles).map(([id, v]) => ({
  id,
  kus: v.understeer.gradientDegPerG,
  kusLin: v.understeer.analyticGradientDegPerG,
  accel: v.straightLine.accelTime,
  brake: v.straightLine.brakingDistance,
  decel: v.straightLine.meanDeceleration,
  locked: v.straightLine.wheelLocked,
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
        <th>K<sub>us</sub> simulated (deg/g)</th>
        <th>K<sub>us</sub> linear theory (deg/g)</th>
        <th>0–100 km/h (s)</th>
        <th>100–0 km/h (m)</th>
        <th>Mean decel (m/s²)</th>
        <th>Wheels locked</th>
        <th>Scripted drive hash</th>
      </tr>
    </thead>
    <tbody>
      <tr v-for="r in rows" :key="r.id">
        <td>{{ r.id }}</td>
        <td>{{ f(r.kus) }}</td>
        <td>{{ f(r.kusLin) }}</td>
        <td>{{ f(r.accel) }}</td>
        <td>{{ f(r.brake, 1) }}</td>
        <td>{{ f(r.decel) }}</td>
        <td>{{ r.locked ? "yes" : "no" }}</td>
        <td>
          <code>{{ r.hash }}</code>
        </td>
      </tr>
    </tbody>
  </table>
</template>
