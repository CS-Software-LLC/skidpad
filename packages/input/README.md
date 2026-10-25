# @skidpad/input

Keyboard, gamepad, touch and wheel input for
[`@skidpad/core`](https://www.npmjs.com/package/@skidpad/core), filtered
into one normalised frame, plus force feedback (Logitech wheels over WebHID,
gamepad rumble) with safety limits on by default.

```ts
import { GearSelector, InputMixer, KeyboardInput, GamepadInput } from "@skidpad/input";

const gears = new GearSelector({ mode: "automatic" }); // the car's gearbox
const keyboard = new KeyboardInput({ gears });
keyboard.attach(window);
const gamepad = new GamepadInput({ gears });
const input = new InputMixer(
  [
    { name: "keyboard", read: (dt) => keyboard.update(dt) },
    { name: "gamepad", read: (dt) => gamepad.poll(dt) },
  ],
  { gears },
);
// each step
world.setInput(car, input.update(1 / 60));
```

`GamepadInput` softens the stick for driving: a square response curve
(`steerExponent`), and the wheel turns toward the stick over time, winding
on in 0.75 s (`steerRate`, also a live property) and back to centre at 5
locks a second (`steerReturnRate`), with less lock as speed rises (set
`speed` each frame; `steerSpeedHalf`); pass the step to `poll(dt)`.

`WheelInput` reads wheels and pedals through calibrated, plain-JSON profiles;
`AxisFinder` and `AxisCalibrator` build a setup flow; `TouchInput` is a
DOM-free touch model. `LogitechWebHidSink` picks its protocol from the
wheel's product id and rejects `connect()` when no force path comes up. It
sends the core's step-averaged steering torque and the car's column
friction and (speed-sensitive) damping to the wheel's own effects, can
play the torque out between host steps (`playoutRate`), set the wheel's
rotation (`setRotation`) and measure its damper's units
(`measureDamper`). Every protocol constant is marked [VERIFY] until tried
on hardware.

Guide: [input, wheels and force feedback](https://cs-software-llc.github.io/skidpad/docs/guide/force-feedback).

License: MIT OR Apache-2.0.
