import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  base: process.env.SANDBOX_BASE ?? "./",
  plugins: [react()],
  build: { target: "es2022", outDir: "dist" },
  server: { fs: { allow: ["../.."] } },
});
