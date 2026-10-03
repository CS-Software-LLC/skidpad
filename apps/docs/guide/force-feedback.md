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

The setup flow assigns controls with `AxisFinder`, which reports the axis
the player is moving. Pass the axes already assigned to `result(threshold,
exclude)` so brushing the throttle while finding the brake does not pick the
throttle again, and `binding(found, centred, rest)` turns the result into a
calibrated binding. Profile patterns are JavaScript regular expressions
matched against `Gamepad.id`; a leading `(?i)` makes one case-insensitive.
Pads with the browser's standard gamepad mapping are left to
`GamepadInput` (wheels report a non-standard mapping), unless you pass
`matchStandardPads: true`.

## Several devices and one gearbox

Each device class can hold the requested gear itself, but a car has one
gearbox. Create one `GearSelector` with the car's transmission mode and pass
it to every device: with `mode: "automatic"` a shift down from drive selects
reverse and a shift up from reverse selects drive, so no device can count
forward gears the automatic ignores. `InputMixer` reads every device each
frame and passes on the one the player touched last:

```ts
import { GearSelector, InputMixer, KeyboardInput, GamepadInput, WheelInput } from "@skidpad/input";

const gears = new GearSelector({ mode: "automatic" }); // the car's gearbox
const keyboard = new KeyboardInput({ gears });
const gamepad = new GamepadInput({ gears }); // bumpers shift, Y toggles reverse
const wheel = new WheelInput({ gears });
const input = new InputMixer(
  [
    { name: "keyboard", read: (dt) => keyboard.update(dt) },
    { name: "gamepad", read: () => gamepad.poll() },
    { name: "wheel", read: () => wheel.poll() },
  ],
  { gears },
);
// each step
world.setInput(car, input.update(dt));
```

`GamepadInput.poll()` reads the first pad with the standard mapping, so a
connected wheel is never read as a gamepad, and leaves it in `lastPad` for a
rumble sink.

## Safety first

A force-feedback wheel is a motor. A direct-drive base like the G PRO can
spin faster than a hand can follow and hard enough to hurt a wrist or a
thumb in the spokes, most easily when the torque's sign is wrong (the
self-centring force then drives the wheel away from the centre) or when the
car spins. The input package defaults are chosen for that:

- `maxOutput` (Logitech sink, default 0.4): the largest fraction of the
  device's peak torque ever sent, about 4.4 N·m on a G PRO. It applies
  after every gain.
- `gain` (default 0.5) on the physical torque, and a rate limit
  (`slewRate`, default 5 full scales per second) so no frame can snap the
  wheel.
- A runaway guard: when the hand wheel moves away from the centre faster
  than `runawayRate` (default 10 rad/s, about 570°/s) for `runawayTime`
  (0.1 s) while a force is applied, the output latches at zero until
  `scaler.rearm()`. It needs the hand-wheel angle in the frame
  (`ffbFrameFromTelemetry`'s third argument).
- A watchdog: the force goes to zero when the page is hidden or closed, or
  when no update has arrived for `watchdog` seconds (default 0.25), so a
  paused host cannot leave a force playing.

On a new wheel or a new protocol, keep your hands clear, press the
sandbox's **Test pulse** first (it should turn the wheel gently to the
right; if it turns left, tick **invert**), and raise gain and max output
only after that.

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

By default (`protocol: "auto"`) the sink picks the protocol from the
device's USB product id when it attaches, using the ids of the Linux drivers
(`LOGITECH_WHEELS`, `logitechWheel(productId)`), and takes the wheel's peak
torque from the same table, so a G29 gets the classic protocol and about
2.5 N·m rather than the G PRO's 11. A wheel the table does not know gets
HID++ and 11 N·m; pass `protocol` (or set `sink.protocol` before attaching)
and `maxTorque` to override either.

`connect()` and `attach()` reject when the force path cannot be set up (the
HID++ feature does not answer, or the wheel refuses the constant-force
effect), with the device closed again and the reason in the diagnostics log.
`sink.ready` says whether forces are being sent; `connected` only says the
device is open.

**Every protocol constant is marked `[VERIFY]` until it has been tried on
hardware.** The sink keeps a diagnostics log of every report sent and
received; if your wheel does nothing or does the wrong thing, copy the log
from the sandbox panel into an issue with the wheel model and the browser
version, and try the other protocol and the other update mode (`modify`
re-sends the effect with its slot id, `recreate` destroys and downloads it).

A wheel exposes several HID interfaces (its gamepad and its HID++ channel);
`connect()` opens the one that declares HID++ long or very long output
reports and logs the report ids it found. HID++ 2.0 commands always go out
as long or very long reports, as the Linux driver sends them: the G PRO does
not accept the 7-byte short report and the browser rejects the write with
`NotAllowedError: Failed to write the report`.

```ts
const sink = new LogitechWebHidSink({ rotationDeg: 900 }); // protocol from the product id
button.onclick = () => sink.connect(); // must be a user gesture
// each host step; the hand-wheel angle feeds the runaway guard
sink.update(
  ffbFrameFromTelemetry((c) => world.read(car, c), def.steering, wheel.status.wheelAngleDeg),
  1 / 60,
);
```

`FfbScaler` turns N·m into the device's −1 … 1 with a gain, a smoothing time
constant, the rate limit, the runaway guard and clipping statistics, so the
panel can show how much of the signal the wheel cannot reproduce. A
direct-drive G PRO is taken as 11 N·m peak, belt wheels as 2 to 3, and
`maxOutput` scales that down. The HID++ sign was found on a G PRO, where a
positive constant force turns the wheel left, so the sink flips it; on a
G923 or G920 check it with the test pulse.

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
