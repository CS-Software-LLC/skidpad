---
"@skidpad/input": patch
---

input: the Logitech HID++ force-feedback sink now follows the byte layout of the Linux driver's G920 / G923 path. Every effect command leads with its slot byte, which was missing, so each field landed one byte early and the wheel ignored the forces. Connecting now replaces the firmware's centring spring with a zero-strength one; a reset alone left it on and held the wheel stiffly to the centre. Effect states use play 0x02 and stop 0x01, the global gain no longer sets boost, condition effects go out in very long (0x12) reports, replies are matched to their request, and HID++ error codes and send failures appear in the diagnostics log.
