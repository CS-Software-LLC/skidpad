// Prints the circuit's layout limits and writes a plan and elevation SVG.
// Run: pnpm --filter @skidpad/sandbox exec tsx scripts/circuit-preview.ts [out.svg]
import { writeFileSync } from "node:fs";
import { buildCircuit } from "../src/circuit/geometry.js";
import { CIRCUIT } from "../src/circuit/layout.js";
import { layoutStats } from "../src/circuit/stats.js";

const g = buildCircuit(CIRCUIT);
const st = layoutStats(g);
console.log(JSON.stringify(st, null, 2));

const out = process.argv[2];
if (out) {
  const xs = g.samples.map((s) => s.x);
  const zs = g.samples.map((s) => s.z);
  const ys = g.samples.map((s) => s.y);
  const pad = 40;
  const minX = Math.min(...xs) - pad;
  const minZ = Math.min(...zs) - pad;
  const w = Math.max(...xs) - minX + pad;
  const h = Math.max(...zs) - minZ + pad;
  const yMin = Math.min(...ys);
  const yMax = Math.max(...ys);
  const col = (y: number) => {
    const t = (y - yMin) / (yMax - yMin || 1);
    return `hsl(${240 - 240 * t},70%,50%)`;
  };
  const parts: string[] = [];
  for (let i = 0; i < g.samples.length; i++) {
    const a = g.samples[i]!;
    const b = g.samples[(i + 1) % g.samples.length]!;
    parts.push(
      `<line x1="${a.x}" y1="${a.z}" x2="${b.x}" y2="${b.z}" stroke="${col(a.y)}" stroke-width="${a.width}"/>`,
    );
  }
  CIRCUIT.points.forEach((p, i) =>
    parts.push(`<text x="${p.x + 8}" y="${p.z - 8}" font-size="14" fill="#fff">${i}</text>`),
  );
  for (const gt of g.gates)
    parts.push(
      `<line x1="${gt.a[0]}" y1="${gt.a[1]}" x2="${gt.b[0]}" y2="${gt.b[1]}" stroke="#fff" stroke-width="2"/>`,
    );
  for (const b of g.barriers)
    parts.push(
      `<circle cx="${b.center[0]}" cy="${b.center[2]}" r="1.5" fill="${b.kind === "wall" ? "#ccc" : "#f80"}"/>`,
    );
  const prof: string[] = [];
  const L = g.length;
  const PH = 160;
  g.samples.forEach((s, i) => {
    if (i % 4) return;
    prof.push(
      `${(s.s / L) * w + minX},${minZ + h + PH - ((s.y - yMin) / (yMax - yMin || 1)) * (PH - 20)}`,
    );
  });
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${minX} ${minZ} ${w} ${h + PH + 40}" width="1400" style="background:#1a1d24">
${parts.join("\n")}
<polyline points="${prof.join(" ")}" fill="none" stroke="#9cf" stroke-width="2"/>
<text x="${minX + 10}" y="${minZ + h + 20}" font-size="16" fill="#9cf">elevation ${yMin.toFixed(1)}–${yMax.toFixed(1)} m over ${L.toFixed(0)} m</text>
</svg>`;
  writeFileSync(out, svg);
}
