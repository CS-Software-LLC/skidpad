import { defineConfig } from "vite";

export default defineConfig({
  build: {
    outDir: "out/harness",
    emptyOutDir: true,
    lib: {
      entry: "browser/harness.ts",
      name: "cpDeterminism",
      formats: ["iife"],
      fileName: () => "harness.js",
    },
    minify: false,
    target: "es2022",
  },
});
