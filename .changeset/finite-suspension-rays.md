---
"@skidpad/core": patch
---

physics: restrict four-wheel suspension contacts to the finite forward ray. Behind-origin plane intersections during rapid steering and rollover could generate enormous contact lever arms and nonfinite chassis motion. Valid forward contacts and bump stops keep their existing behavior. The built-in host still has no chassis collision body; external hosts remain responsible for rollover collisions. Snapshot and definition formats are unchanged.
