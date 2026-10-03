---
"@skidpad/core": patch
---

The WASM build now re-encodes the module with `wasm-opt` (binaryen is a dev dependency), which drops the padded integers the linker leaves: 611 KB instead of 657 KB, 198 KB gzipped. No optimisation passes run, so the code is unchanged. The WASM ABI version is 6.
