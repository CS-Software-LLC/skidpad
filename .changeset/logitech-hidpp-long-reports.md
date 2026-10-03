---
"@skidpad/input": patch
---

Send HID++ 2.0 force-feedback commands as long (0x11) or very long (0x12) reports instead of short (0x10) ones, which the G PRO refuses with "NotAllowedError: Failed to write the report". `connect()` now picks the wheel interface that declares HID++ output reports (new `pickHidppDevice` and `outputReportIds` helpers), and the diagnostics log lists the output reports of the opened interface.
