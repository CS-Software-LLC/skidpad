<script setup lang="ts">
import { onBeforeUnmount, onMounted, reactive, ref, watch } from "vue";
import { TireExplorer, defaultState } from "../explorers/tire-explorer";

const canvas = ref<HTMLCanvasElement | null>(null);
const state = reactive({ ...defaultState });
const status = ref("loading the core…");
let explorer: TireExplorer | undefined;

onMounted(async () => {
  if (!canvas.value) return;
  explorer = new TireExplorer(canvas.value);
  try {
    await explorer.load();
    status.value = "";
    explorer.draw(state);
  } catch (e) {
    status.value = `failed to load: ${String(e)}`;
  }
});
watch(state, () => explorer?.draw(state));
onBeforeUnmount(() => explorer?.dispose());
</script>

<template>
  <div class="explorer">
    <canvas ref="canvas" style="width: 100%; display: block"></canvas>
    <p v-if="status" class="status">{{ status }}</p>
    <div class="controls">
      <label
        >Model
        <select v-model="state.model">
          <option value="feel">Feel</option>
          <option value="mf">Magic Formula (defaults)</option>
        </select></label
      >
      <label
        >Load {{ state.fz }} N
        <input type="range" min="500" max="9000" step="100" v-model.number="state.fz"
      /></label>
      <label
        >Camber {{ state.camberDeg }}°
        <input type="range" min="-8" max="8" step="0.5" v-model.number="state.camberDeg"
      /></label>
      <label
        >Braking slip ratio {{ state.otherSlipRatio }}
        <input type="range" min="-0.3" max="0.3" step="0.01" v-model.number="state.otherSlipRatio"
      /></label>
      <template v-if="state.model === 'feel'">
        <label
          >Peak friction {{ state.peakFriction }}
          <input type="range" min="0.3" max="1.8" step="0.05" v-model.number="state.peakFriction"
        /></label>
        <label
          >Peak slip angle {{ state.peakSlipAngleDeg }}°
          <input type="range" min="3" max="14" step="0.5" v-model.number="state.peakSlipAngleDeg"
        /></label>
        <label
          >Cornering stiffness {{ state.corneringStiffness }} /rad
          <input type="range" min="6" max="40" step="1" v-model.number="state.corneringStiffness"
        /></label>
        <label
          >Falloff {{ state.falloff }}
          <input type="range" min="0.4" max="1" step="0.05" v-model.number="state.falloff"
        /></label>
      </template>
    </div>
  </div>
</template>

<style scoped>
.explorer {
  border: 1px solid var(--vp-c-divider);
  border-radius: 8px;
  padding: 12px;
  margin: 16px 0;
}
.controls {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 8px 16px;
  margin-top: 8px;
  font-size: 13px;
}
.controls label {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.status {
  font-size: 13px;
  opacity: 0.7;
}
</style>
