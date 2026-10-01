import { init } from "@contactpatch/core/compat";
import { formatTable, runAll, type BenchReport } from "./bench.js";

const out = document.getElementById("out")!;
const button = document.getElementById("run") as HTMLButtonElement;
const dash = document.getElementById("dashboard")!;

async function loadDashboard(): Promise<void> {
  try {
    const res = await fetch("./results/index.json");
    if (!res.ok) throw new Error(String(res.status));
    const files = (await res.json()) as string[];
    const rows: string[] = [];
    for (const f of files) {
      const r = (await (await fetch(`./results/${f}`)).json()) as BenchReport;
      rows.push(
        `<tr><td>${r.timestamp}</td><td>${r.platform}</td>${r.results.map((x) => `<td>${x.msPerStep.toFixed(3)}</td>`).join("")}</tr>`,
      );
    }
    dash.innerHTML = `<table><thead><tr><th>When</th><th>Platform</th>${((await (await fetch(`./results/${files[0]}`)).json()) as BenchReport).results.map((x) => `<th>${x.label}</th>`).join("")}</tr></thead><tbody>${rows.join("")}</tbody></table>`;
  } catch {
    dash.textContent =
      "No published results yet. CI publishes results/index.json on every merge to main.";
  }
}

button.addEventListener("click", async () => {
  button.disabled = true;
  out.textContent = "running…";
  const cp = await init();
  await new Promise((r) => setTimeout(r, 50));
  const report = runAll(cp, navigator.userAgent, () => performance.now());
  out.textContent = formatTable(report) + "\n\n" + JSON.stringify(report, null, 2);
  button.disabled = false;
});

void loadDashboard();
