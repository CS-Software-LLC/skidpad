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
    { name: "gamepad", read: () => gamepad.poll() },
  ],
  { gears },
);
// each step
world.setInput(car, input.update(1 / 60));
```

`WheelInput` reads wheels and pedals through calibrated, plain-JSON profiles;
`AxisFinder` and `AxisCalibrator` build a setup flow; `TouchInput` is a
DOM-free touch model. `LogitechWebHidSink` picks its protocol from the
wheel's product id and rejects `connect()` when no force path comes up.

Guide: [wheels and force feedback](https://cs-software-llc.github.io/skidpad/docs/guide/force-feedback).

License: MIT OR Apache-2.0.
