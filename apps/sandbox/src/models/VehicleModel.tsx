import type { MutableRefObject } from "react";
import type { PresetId } from "@skidpad/presets";
import { Hatchback } from "../Hatchback.js";
import type { SimSnapshot } from "../sim.js";
import { Crossover, Pickup, SportsCoupe } from "./RoadVehicles.js";
import { Kart, OpenWheeler } from "./RaceVehicles.js";
import type { ModelDimensions } from "./types.js";

export function VehicleModel({
  preset,
  dimensions,
  snapshot,
}: {
  preset: PresetId;
  dimensions: ModelDimensions;
  snapshot: MutableRefObject<SimSnapshot>;
}) {
  switch (preset) {
    case "hatchbackFwd":
      return <Hatchback {...dimensions} />;
    case "sportsRwd":
      return <SportsCoupe d={dimensions} />;
    case "pickup4x4":
      return <Pickup d={dimensions} />;
    case "crossoverEv":
      return <Crossover d={dimensions} />;
    case "kart":
      return <Kart d={dimensions} snapshot={snapshot} />;
    case "openWheeler":
      return <OpenWheeler d={dimensions} snapshot={snapshot} />;
  }
}
