# ADR-0004: VitePress for the documentation site

- Status: Accepted
- Date: 2026-10-01

## Context

The docs are a feature: every concept page embeds an interactive explainer that
runs the real core. The site must build fast, deploy as static files for PR
previews, and generate an API reference from TypeScript types.

## Decision

VitePress. Markdown pages with custom components for the interactive
explainers. The explainers are written as framework-agnostic TypeScript
functions that take a canvas and the core module, wrapped in a thin Vue
component for mounting. The API reference is generated with TypeDoc (markdown
plugin) into the docs tree.

## Alternatives considered

- **Astro Starlight.** Equally capable and would allow React islands, which
  matches the sandbox. Rejected for now on build complexity and a heavier
  dependency set; the explainers are deliberately framework-agnostic so this
  decision is cheap to reverse.
- **Docusaurus.** Heavier and slower builds. Rejected.

## Consequences

- One small Vue wrapper component per explainer. Everything else is TypeScript
  shared with the sandbox where possible.
- Docs build in CI on every PR and deploy as a preview alongside the sandbox.
