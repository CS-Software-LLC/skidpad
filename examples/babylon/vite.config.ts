import { defineConfig } from "vite";

export default defineConfig({
  base: process.env.BABYLON_EXAMPLE_BASE ?? "./",
  build: { target: "es2022", outDir: "dist" },
  server: { fs: { allow: ["../.."] } },
});
