---
"@skidpad/input": patch
---

- input: wheel steering axes have no centre dead zone (was 2 % of half the rotation, up to ±11° of rim with the rotation matched to a car's lock). Inside it the car went straight and the core sent no aligning torque, so the rim could sit turned at speed. Profiles saved with the old 2 % load with none; `CENTRED_DEADZONE` is exported.
