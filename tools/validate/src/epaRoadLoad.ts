/**
 * Road-load targets of real cars from EPA's Test Car List, model year 2025
 * (https://www.epa.gov/compliance-and-fuel-economy-data/data-cars-used-testing-fuel-economy,
 * file `25-testcar-2026-01-21.xlsx`, columns "Target Coef A (lbf)",
 * "Target Coef B (lbf/mph)", "Target Coef C (lbf/mph**2)" and "Equivalent
 * Test Weight (lbs.)"). Public-domain US government data. Each is the
 * first row listed for that model and drive; the targets come from the
 * maker's coast-down of a representative car in neutral.
 *
 * The presets are generic cars, so each is compared with a few cars of its
 * class rather than one; the kart and the open-wheeler have no EPA
 * equivalent.
 */
import type { PresetId } from "@skidpad/presets";

export interface EpaRoadLoad {
  car: string;
  /** Equivalent test weight, lb: curb weight plus 300 lb, rounded to a class. */
  etwLb: number;
  aLbf: number;
  bLbfMph: number;
  cLbfMph2: number;
}

const MPH = 0.44704;
const LBF = 4.4482216152605;

/** Road load of `r` at `kmh`, N. */
export function epaForce(r: EpaRoadLoad, kmh: number): number {
  const v = kmh / 3.6 / MPH;
  return (r.aLbf + r.bLbfMph * v + r.cLbfMph2 * v * v) * LBF;
}

export const EPA_ROAD_LOAD: Partial<Record<PresetId, EpaRoadLoad[]>> = {
  hatchbackFwd: [
    {
      car: "Honda Civic 5-door, 150 hp",
      etwLb: 3250,
      aLbf: 30.68,
      bLbfMph: -0.1568,
      cLbfMph2: 0.02095,
    },
    {
      car: "Toyota Corolla Hatchback",
      etwLb: 3375,
      aLbf: 24.315,
      bLbfMph: 0.28828,
      cLbfMph2: 0.01753,
    },
    {
      car: "Volkswagen Golf R (AWD)",
      etwLb: 3750,
      aLbf: 36.52,
      bLbfMph: 0.3526,
      cLbfMph2: 0.01892,
    },
  ],
  sportsRwd: [
    { car: "BMW Z4 sDrive30i", etwLb: 3625, aLbf: 57, bLbfMph: -0.309, cLbfMph2: 0.02139 },
    { car: "Subaru BRZ, manual", etwLb: 3125, aLbf: 27, bLbfMph: 0.3452, cLbfMph2: 0.01716 },
    { car: "Nissan Z", etwLb: 3875, aLbf: 41.38, bLbfMph: 0.4521, cLbfMph2: 0.01931 },
    {
      car: "Porsche 718 Cayman GTS 4.0",
      etwLb: 3625,
      aLbf: 40.466,
      bLbfMph: 0.44863,
      cLbfMph2: 0.015139,
    },
  ],
  pickup4x4: [
    { car: "Ford F-150 4WD, 325 hp", etwLb: 5250, aLbf: 24.85, bLbfMph: 0.3112, cLbfMph2: 0.03401 },
    {
      car: "Chevrolet Silverado 4WD, 310 hp",
      etwLb: 5250,
      aLbf: 30.77,
      bLbfMph: 0.5572,
      cLbfMph2: 0.03235,
    },
    { car: "Ram 1500 4x4, 305 hp", etwLb: 5500, aLbf: 38.76, bLbfMph: 0.2402, cLbfMph2: 0.03416 },
  ],
  crossoverEv: [
    {
      car: "Tesla Model Y Long Range AWD",
      etwLb: 4750,
      aLbf: 37.77,
      bLbfMph: -0.1538,
      cLbfMph2: 0.02044,
    },
    { car: "Hyundai Ioniq 5 AWD", etwLb: 5000, aLbf: 30.437, bLbfMph: 0.12091, cLbfMph2: 0.023022 },
    {
      car: "Volkswagen ID.4 AWD Pro",
      etwLb: 5250,
      aLbf: 29.65,
      bLbfMph: 0.2534,
      cLbfMph2: 0.01836,
    },
    {
      car: "Ford Mustang Mach-E Extended Range AWD",
      etwLb: 5000,
      aLbf: 31.47,
      bLbfMph: 0.2998,
      cLbfMph2: 0.01775,
    },
  ],
};

/** How far outside its class's range a road load may sit and still count as in it. */
export const EPA_BAND_MARGIN = 0.1;

/**
 * Where `force` (N) at `kmh` sits against the class: its range of road
 * loads, and how far outside the range widened by {@link EPA_BAND_MARGIN}
 * it is (0 inside, positive above, negative below, as a fraction).
 */
export function epaBand(
  refs: EpaRoadLoad[],
  kmh: number,
  force: number,
): { min: number; max: number; outside: number } {
  const fs = refs.map((r) => epaForce(r, kmh));
  const min = Math.min(...fs);
  const max = Math.max(...fs);
  const lo = min * (1 - EPA_BAND_MARGIN);
  const hi = max * (1 + EPA_BAND_MARGIN);
  const outside = force > hi ? force / hi - 1 : force < lo ? force / lo - 1 : 0;
  return { min, max, outside };
}
