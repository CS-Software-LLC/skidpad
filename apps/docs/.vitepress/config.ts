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
          { text: "Determinism contract", link: "/guide/determinism-contract" },
        ],
      },
      {
        text: "Concepts",
        items: [
          { text: "Slip ratio and slip angle", link: "/concepts/slip" },
          { text: "Combined slip", link: "/concepts/combined-slip" },
          { text: "Load transfer", link: "/concepts/load-transfer" },
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
