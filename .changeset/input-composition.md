---
"@skidpad/input": minor
---

Devices compose, and gears follow the car:

- `GearSelector` holds one requested gear for every device. In `"automatic"` mode it only moves between reverse (−1) and drive (0), so a keyboard can no longer count up to gear 10 that the automatic ignores and then need ten presses to reach reverse; in `"manual"` mode (the default) it counts −1 to `maxGear`. `KeyboardInput`, `GamepadInput` and `WheelInput` take it as `gears` (and keep a `gear` property); `KeyboardMapping` gains an optional `reverse` key list.
- `InputMixer` reads several devices each frame and passes on the one the player touched last, with the shared gear.
- `GamepadInput` shifts: bumpers shift up and down and the top face button toggles reverse (all configurable, `-1` for none). `poll()` reads the first pad with the standard mapping (`pick` to choose otherwise) instead of whatever pad comes first, which was the wheel when one was plugged in, and leaves it in `lastPad` for a rumble sink.
- `WheelInput.match` leaves standard-mapping gamepads out (`matchStandardPads` to include them), so the generic wheel profile's `046d` no longer matches a Logitech gamepad. The G PRO profile no longer matches every Logitech device: its pattern `046d.*(PRO|Pro)` matched the "Product:" in Chromium's ids, so a G29 got the G PRO profile.
- `AxisFinder.result(threshold, exclude)` leaves out assigned axes and reports the raw range seen; `AxisFinder.binding(found, centred, rest)` makes a calibrated binding from it. The `(?i)` prefix of profile patterns is documented, and a stale doc comment on `GamepadInput` is gone.
