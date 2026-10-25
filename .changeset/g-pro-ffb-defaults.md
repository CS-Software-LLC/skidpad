---
"@skidpad/input": patch
---

- input: the G PRO models carry a measured `damperRate` of 8.5 rad/s (`G_PRO_DAMPER_RATE`, from `measureDamper()` on a G PRO); `LogitechWebHidSink.damperRate` defaults to the attached model's value, else 10, and setting it to `undefined` goes back to the model's. The sandbox's wheel panel now starts with the settings driven on a G PRO: Column feel 2×, sub-frame playout at 500 Hz, the direct-drive slew and smoothing, and the rotation matched to the car.
- input: the G PRO profile's paddles were swapped (up was button 5, down 4); up is now 4 and down 5, and a G PRO profile saved with the old pair is corrected on load.
