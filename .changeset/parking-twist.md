---
"@skidpad/core": minor
---

- core: parking twist (ADR-0039). A steered tire with `contactRadius` and `torsionalStiffness` both set resists being turned on the spot: its contact patch twists like a spring, then slides at `⅔·μ·Fz·a`, and the effect fades out by walking pace. The moment adds to the aligning moment, so it reaches the hand wheel. Off by default and in every preset; definitions without the two settings run bit for bit as before. The sandbox's Tuning panel has a switch to try it.
