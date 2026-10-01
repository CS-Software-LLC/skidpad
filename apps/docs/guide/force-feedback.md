# Wheels and force feedback

Skidpad's core computes the torque the tires put on the hand wheel
(`SteeringTorque`, see [steering](/concepts/steering)); the `@skidpad/input`
package reads wheels and pedals and sends that torque back to the device.

## Reading a wheel

Any wheel the browser exposes as a gamepad works through `WheelInput`. A
profile binds its axes and buttons: which axis is the steering, which pedal
is which, where the paddles are, and the wheel's rotation. Three profiles
ship (Logitech G PRO with PRO pedals, G29/G923, a generic wheel); the
sandbox's **Wheel setup** panel assigns each control by moving it and
records the end stops, so the shipped axis numbers only have to be close.
Profiles are plain JSON and persist in `localStorage`.

Steering is scaled by the car, not the wheel: with a 900° wheel and a car
whose `steering.ratio × maxWheelAngleDeg` is 490°, 490° of hand wheel is
full lock and the rest is past the stops, so the road wheels turn exactly as
the definition's ratio says and the force-feedback torque means what the
core computed.

```ts
import { WheelInput, ffbFrameFromTelemetry, LogitechWebHidSink } from "@skidpad/input";

const wheel = new WheelInput({
  steeringLockDeg: def.steering.ratio * def.steering.maxWheelAngleDeg,
});
const frame = wheel.poll(); // undefined until a known wheel is connected
```

## Sending torque back

The web has no standard force-feedback channel. The Gamepad API only
vibrates, so `GamepadRumbleSink` maps torque magnitude to the strong motor
as a fallback. Real force feedback goes through **WebHID**, which Chromium
(Chrome, Edge, Opera, Brave) exposes and Firefox and Safari do not. A page
asks for the device with `requestDevice()` from a click, the browser shows a
chooser, and from then on the page can send the wheel its own reports.

Each wheel speaks its own protocol. `LogitechWebHidSink` implements two,
reconstructed from the public Linux drivers:

- `hidpp` for the G PRO, G923 and G920: HID++ 2.0 feature 0x8123. A
  constant-force effect is downloaded once and updated every host step.
- `classic` for the G29, G27 and G25 (and the G923 in compatibility mode):
  the seven-byte command reports.

**Every protocol constant is marked `[VERIFY]` until it has been tried on
hardware.** The sink keeps a diagnostics log of every report sent and
received; if your wheel does nothing or does the wrong thing, copy the log
from the sandbox panel into an issue with the wheel model and the browser
version, and try the other protocol and the other update mode (`modify`
re-sends the effect with its slot id, `recreate` destroys and downloads it).

```ts
const sink = new LogitechWebHidSink({ protocol: "hidpp", rotationDeg: 900, gain: 1 });
button.onclick = () => sink.connect(); // must be a user gesture
// each host step
sink.update(
  ffbFrameFromTelemetry((c) => world.read(car, c), def.steering),
  1 / 60,
);
```

`FfbScaler` turns N·m into the device's −1 … 1 with a gain, a smoothing time
constant and clipping statistics, so the panel can show how much of the
signal the wheel cannot reproduce. A direct-drive G PRO is taken as 11 N·m
at full output; belt wheels as 2 to 3.

Column friction and damping are definition values (`steering.columnFriction`,
`steering.columnDamping`) meant for the device's own friction and damper
effects; the HID++ sink downloads those effects but does not yet scale them
[VERIFY].

## Other makers

Protocols for other wheels belong in separate packages that implement
`FfbSink`, so the core and the input package stay clean-room. A desktop
build can use the same sinks over `node-hid` in Electron.

## Touch

`TouchInput` is an on-screen control model for phones and tablets: the left
half of the screen is a steering strip (drag sideways, returns to centre),
the right half a pedal column (upper half throttle, lower half brake).
