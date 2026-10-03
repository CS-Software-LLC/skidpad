---
"@skidpad/core": patch
---

The WASM build now re-encodes the module with `wasm-opt` (binaryen is a dev dependency), which drops the padded integers the linker leaves: about 7 % smaller, with the gzipped size about 1 % smaller. No optimisation passes run, so the code is unchanged. The WASM ABI version is 6.
