---
"@skidpad/input": minor
---

- input: `FfbScaler` keeps the car's peak steering torque over the last minute (`carPeak`, a new `TorquePeak` window) and `autoGain()` returns the gain that puts it at 90 % of the rim's limit (`rimLimit`), within 0.05 to 2, after 10 s of driving. It never sets the gain itself; the defaults are unchanged.
