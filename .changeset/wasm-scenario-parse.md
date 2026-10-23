---
"@skidpad/core": patch
---

The WASM core is about 11 % smaller gzipped (221,831 to 197,262 bytes; 664 KB to 540 KB raw). `runScenario` requests are now read in two passes, the scenario name first, instead of as a serde enum tagged by `scenario`, which compiled the whole vehicle definition's parser a second time. Requests and results are unchanged; a malformed request's error message may now include a line and column. The build also maps `CARGO_HOME` to a fixed path, so a local release build is byte-identical to CI's. No simulation result changes.
