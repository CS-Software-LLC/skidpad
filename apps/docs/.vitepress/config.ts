import { defineConfig } from "vitepress";

export default defineConfig({
  title: "Skidpad",
  description: "Deterministic, sim-grade vehicle physics for the web.",
  base: process.env.DOCS_BASE ?? "/",
  cleanUrls: true,
  themeConfig: {
    nav: [
      { text: "Guide", link: "/guide/getting-started" },
      { text: "Concepts", link: "/concepts/slip" },
      { text: "Tuning", link: "/tuning/" },
      { text: "Validation", link: "/validation/" },
      { text: "Roadmap", link: "/roadmap" },
      { text: "GitHub", link: "https://github.com/csummers88/skidpad" },
    ],
    sidebar: [
      {
        text: "Guide",
        items: [
          { text: "Getting started", link: "/guide/getting-started" },
          { text: "Vehicle definitions", link: "/guide/definitions" },
          { text: "Driving a Rapier body", link: "/guide/rapier" },
          { text: "Driving a Jolt body", link: "/guide/jolt" },
          { text: "Many cars: LOD and drivers", link: "/guide/scale" },
          { text: "Replays and ghosts", link: "/guide/replays" },
          { text: "Worker mode", link: "/guide/worker" },
          { text: "Determinism contract", link: "/guide/determinism-contract" },
          { text: "Wheels and force feedback", link: "/guide/force-feedback" },
        ],
      },
      {
        text: "Concepts",
        items: [
          { text: "Slip ratio and slip angle", link: "/concepts/slip" },
          { text: "Combined slip", link: "/concepts/combined-slip" },
          { text: "Load transfer", link: "/concepts/load-transfer" },
          { text: "Suspension and the four-wheel model", link: "/concepts/suspension" },
          { text: "Surfaces", link: "/concepts/surfaces" },
          { text: "Aerodynamics", link: "/concepts/aero" },
          { text: "Relaxation length", link: "/concepts/relaxation-length" },
          { text: "Why substepping and the chassis proxy", link: "/concepts/substepping" },
        ],
      },
      { text: "Tuning guide", items: [{ text: "Symptom first", link: "/tuning/" }] },
      { text: "Validation", items: [{ text: "Results", link: "/validation/" }] },
      {
        text: "Project",
        items: [
          { text: "Roadmap", link: "/roadmap" },
          {
            text: "Architecture decisions",
            link: "https://github.com/csummers88/skidpad/tree/main/docs/adr",
          },
        ],
      },
    ],
    search: { provider: "local" },
    footer: { message: "MIT OR Apache-2.0. Built in public." },
  },
  vite: {
    server: { fs: { allow: ["../.."] } },
    ssr: { noExternal: ["@skidpad/core", "@skidpad/presets"] },
  },
});
