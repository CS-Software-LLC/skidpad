import type { PresetId } from "@skidpad/presets";

/** Static wheel-centre positions relative to the CG's ground projection. */
export interface ModelDimensions {
  frontAxle: number;
  rearAxle: number;
  frontHalfTrack: number;
  rearHalfTrack: number;
  frontRadius: number;
  rearRadius: number;
  halfWidth: number;
}

export type WheelStyle = "alloy" | "sport" | "offroad" | "aero" | "kart" | "slick";

/** Artwork dimensions only; tire widths are not part of the contact model. */
export const WHEEL_STYLES: Record<PresetId, { style: WheelStyle; widths: [number, number] }> = {
  hatchbackFwd: { style: "alloy", widths: [0.22, 0.22] },
  sportsRwd: { style: "sport", widths: [0.235, 0.255] },
  pickup4x4: { style: "offroad", widths: [0.28, 0.28] },
  crossoverEv: { style: "aero", widths: [0.255, 0.255] },
  kart: { style: "kart", widths: [0.13, 0.19] },
  openWheeler: { style: "slick", widths: [0.24, 0.32] },
};
