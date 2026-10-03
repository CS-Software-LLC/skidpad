---
"@skidpad/input": minor
---

`LogitechWebHidSink` picks its protocol from the wheel's product id. The new default `protocol: "auto"` looks the device up in `LOGITECH_WHEELS` (ids from the Linux drivers; `logitechWheel(productId)` exposes the lookup) when it attaches, so a G29 now gets the classic protocol instead of HID++, and an unknown wheel still falls back to HID++. `peakTorque` is now derived from the attached wheel, or from the protocol actually in use, instead of being fixed by the constructor, so forcing `sink.protocol` before `attach()` no longer leaves the torque scale four times off.

Breaking: `attach()` and `connect()` now reject, closing the device again, when the force path cannot be set up (the HID++ force-feedback feature does not answer, or the wheel refuses the constant-force effect). Before, the sink reported `connected` and silently sent nothing. The new `ready` getter says whether forces are being sent, and `wheel` names the recognised model.
