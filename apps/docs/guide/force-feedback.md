# Input, wheels and force feedback

Skidpad's core computes the torque the tires put on the hand wheel
(`SteeringTorque`, see [steering](/concepts/steering)); the `@skidpad/input`
package reads keyboards, gamepads, wheels and touch screens into one
filtered input frame, and sends that torque back to a wheel. Filtering
happens in the input package, before the core, so a recorded replay holds
exactly what the car was given, whatever the device.

## Keyboard

`KeyboardInput` turns held keys into ramps: steering rises at 2.5 full
locks per second and falls back at 5, throttle at 3 and 6, brake at 4 and
8 (pass `steer`, `throttle` or `brake` with `riseRate` and `fallRate` to
change them). The default mapping is arrows or WASD to drive, Space for the
handbrake, E or right Shift to shift up, Q or left Shift to shift down, and
C for the clutch; `mapping` replaces any of the key lists, by
`KeyboardEvent.code`. `attach(window)` wires the listeners and `update(dt)`
reads a frame.

A key steers to full lock, which is far too much at speed. The core's
steering assist (`assists.steeringAssist`, see [assists](/concepts/assists))
caps the road-wheel angle by speed and is the usual fix for keyboard
driving; it is off unless the definition turns it on.

## Gamepad

`GamepadInput` reads the first pad with the browser's standard mapping:
left stick steers, right trigger is throttle, left trigger brake, the
bottom face button the handbrake, the bumpers shift and the top face button
toggles reverse. Every binding is an option (`-1` for none on the shift
buttons).

A thumb stick travels a few millimetres for what a wheel does in 900°, so
the steering is shaped before it reaches the car:

- `deadzone` (default 0.08) ignores stick drift around the centre.
- `steerExponent` (default 2) is the response curve: half stick asks for
  about a quarter of the range. 1 is linear.
- `steerRate` (default 4/3) is how fast the steering winds on, in full
  locks per second. The stick asks for an angle and the wheel turns toward
  it at this rate, so full stick reaches full lock after 0.75 s rather than in one
  frame, the way console racing games turn the wheel. It is also a
  property, so a settings slider can change it while driving; the
  sandbox's **Pad steering** slider sets the time to full lock (its
  inverse). `Infinity` turns it off.
- `steerReturnRate` (default 5) is how fast the steering unwinds toward
  centre, faster than winding on so letting go straightens the car
  promptly.
- `steerSpeedHalf` (default 20 m/s, about 72 km/h) is the speed at which
  full stick asks for half lock. The lock falls as `1 / (1 + (v / half)²)`,
  so at speed the stick's whole travel covers the few degrees a corner
  needs and a small thumb movement is a small correction, while full lock
  is still there when slow. It needs the car's speed: set the `speed`
  property (m/s) before each read; left at 0 nothing is scaled. Also a live
  property (the sandbox's **Pad at speed** slider, in km/h); `Infinity`
  turns it off. It scales the wound-on angle, so turn-in takes the same
  time at any speed.
- `steerSensitivity` (default 1) is the fraction of full lock that full
  stick asks for, also a live property.

The rates need the time between reads, so pass the step to `poll(dt)` (or
`map(axes, buttons, dt)` in a test); it defaults to 1/60 s.

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
    { name: "gamepad", read: (dt) => gamepad.poll(dt) },
    { name: "wheel", read: () => wheel.poll() },
  ],
  { gears },
);
// each step
world.setInput(car, input.update(dt));
```

A device takes over when one of its inputs moves past `threshold` (default
0.15) or it shifts, so a wheel left turned or a pedal resting slightly
above zero does not steal control. `GamepadInput.poll()` reads the first pad
with the standard mapping, so a connected wheel is never read as a gamepad,
and leaves it in `lastPad` for a rumble sink.

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
N·m, and `steering.columnDamping`, N·m per rad/s, at the hand wheel). The
HID++ sink sends them to the wheel's own friction and damper effects, where
the firmware applies them far faster than the host steps, which a damper
needs to stay stable. They are what makes the wheel feel settled around the
centre, where the tires' aligning torque is small. Each is multiplied by
`gain` and by `columnScale` (default 1; the sandbox's **Column feel**
slider), divided by the wheel's peak torque and capped at `maxOutput`. The
damper's coefficient also needs the hand-wheel rate at which the firmware
gives full output, `damperRate` (default 10 rad/s), which no public source
documents [VERIFY]: raise it for less damping. Both effects only resist
motion, so they stay on when the runaway guard or the watchdog cuts the
constant force. The classic protocol does not send them yet.

A definition can raise the damping with speed
(`steering.columnDampingAtSpeed` and `steering.columnDampingSpeed`,
ADR-0033), so the wheel stays light when parking and does not swing when
let go at speed. The core reports the current value on the `ColumnDamping`
channel, `ffbFrameFromTelemetry` sends it, and the sink re-sends the damper
only when it moves by more than about 5 %. The presets other than the kart
reach four times their parking damping by 20 m/s.

`sink.measureDamper(readAngleDeg)` finds the firmware damper's units on
the wheel at hand. With the hands off, it spins the rim at three
constant torques with the damper at a known coefficient, and `fitDamper`
fits torque against the speed reached for the damping, the friction and
the `damperRate` to use. The sandbox's **Measure damping** button runs it
and remembers the result in the browser.

## What the torque signal is

`ffbFrameFromTelemetry` sends `SteeringTorqueMean`, the mean of the
steering torque over the host step's substeps, not the last substep's
value, which aliases anything faster than half the host rate into random
steps (ADR-0031). The core also splits the torque by source
(`SteerTorqueMz`, `SteerTorqueTrail`, `SteerTorqueScrub`,
`SteerTorqueLift`, `SteerTorqueAssist`) for graphs and tuning; see
[steering](/concepts/steering).

A 60 Hz host step still sends the wheel a staircase. The frame also
carries the step's torque in eight equal slices of time
(`SteeringTorqueSlice0` … `7`, ADR-0032), and with `playoutRate` set (Hz,
for example 250 to 500; default 0, off) the sink plays them out between
host steps through `TorquePlayout`, one host step behind, with linear
interpolation. It has not been tried on a wheel yet [VERIFY].

Belt and gear wheels smooth the output themselves; a direct-drive base
does not, and shows the scaler's own rate limit and smoothing as lag.
`DIRECT_DRIVE_SCALER` holds a faster slew (50 full scales per second) and
3 ms of smoothing for such a base; the defaults (5 per second, 10 ms) suit
a G29. Raise the slew only once the sign and the gain are known to be
right.

`sink.setRotation(deg)` sets the wheel's rotation, clamped to the model's
range (1080° on the G PRO), and tells `WheelInput` through its
`rotationDeg`. Set it to the car's lock (`ratio × maxWheelAngleDeg`) and
the wheel's end stop is the car's full lock.

`FfbScaler` reports `requested` (the torque asked of the rim, N·m),
`sent`, `output`, `lastClipped`, `peak` and `clipFraction`, so a setup
panel can show how much of the signal the wheel cannot reproduce.

## The sandbox's wheel panel

**Wheel setup & assists** in the sandbox is a working example of all of
the above: assign and calibrate controls, connect the wheel (protocol from
the model, or forced; update mode), **Test pulse**, **Measure damping**,
**Gain**, **Max output**, **Column feel** (`columnScale`, 0 to 4×),
**invert**, a live graph of the torque requested and sent, **Sub-frame
playout** at 250, 360 or 500 Hz, **Slew** and **Smoothing** with
**Direct drive** and **Gear / belt** presets, **Match rotation to car**,
**Re-enable** after the runaway guard trips, the diagnostics log, and the
assists.

## Other makers

Protocols for other wheels belong in separate packages that implement
`FfbSink`, so the core and the input package stay clean-room. A desktop
build can use the same sinks over `node-hid` in Electron.

## Touch

`TouchInput` is an on-screen control model for phones and tablets: the left
half of the screen is a steering strip (drag sideways, returns to centre),
the right half a pedal column (upper half throttle, lower half brake).
