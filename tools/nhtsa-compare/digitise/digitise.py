"""
Reads the measured traces out of the vector plots in Salaani and Heydinger,
"Model Validation of the 1997 Jeep Cherokee for the National Advanced Driving
Simulator", SAE 2000-01-0700 (the copy NHTSA hosts as jeep_valid.pdf).

The plots are vector drawings, so nothing is traced by eye: each curve is the
polyline the paper's plotting program wrote, and each axis is calibrated from
its own tick marks (short strokes on the frame) and the numbers printed next
to them, by least squares. A curve is told apart from the others in its plot
by its stroke (width and dash), and named from the legend sample drawn in the
same stroke.

    python3 -I digitise.py <jeep_valid.pdf> --list          # every plot found
    python3 -I digitise.py <jeep_valid.pdf> <out_dir>       # write the CSVs

The paper itself is not in the repository (SAE copyright); the CSVs it writes
are, with their source in data/PROVENANCE.md. Needs pdfplumber.
"""

import csv
import json
import re
import sys
from pathlib import Path

import pdfplumber

NUM = re.compile(r"^-?\d+(\.\d+)?$")
TICK = 2.5  # longest stroke counted as a tick mark, pt


def style(obj):
    dash = obj.get("dash") or ([], 0)
    pattern = tuple(round(v, 3) for v in (dash[0] or []))
    return (round(obj["linewidth"], 3), pattern)


def polyline(obj):
    return [(float(x), float(y)) for x, y in obj["pts"]]


def fit(pairs):
    """Least-squares value = a·coord + b from (coord, value) pairs."""
    n = len(pairs)
    mx = sum(c for c, _ in pairs) / n
    my = sum(v for _, v in pairs) / n
    sxx = sum((c - mx) ** 2 for c, _ in pairs)
    a = sum((c - mx) * (v - my) for c, v in pairs) / sxx
    b = my - a * mx
    worst = max(abs(a * c + b - v) for c, v in pairs)
    return a, b, worst


def axes_on(page):
    """Every plot on a page: its frame, calibration, legend and curves."""
    lines = page.lines
    solid = [l for l in lines if not style(l)[1]]
    vticks = [l for l in solid if abs(l["x0"] - l["x1"]) < 0.05 and 0.3 < l["bottom"] - l["top"] < TICK]
    hticks = [l for l in solid if abs(l["top"] - l["bottom"]) < 0.05 and 0.3 < l["x1"] - l["x0"] < TICK]
    words = [w for w in page.extract_words() if NUM.match(w["text"])]

    # Group the x-axis ticks by the frame line they stand on.
    xaxes = {}
    for t in vticks:
        key = round(t["bottom"], 1)
        xaxes.setdefault(key, {})[round(t["x0"], 1)] = t
    yaxes = {}
    for t in hticks:
        key = round(t["x0"], 1)
        yaxes.setdefault(key, {})[round(t["top"], 1)] = t

    found = []
    # Each frame's bottom edge: a long solid horizontal stroke. Plots side by
    # side share a baseline, so the ticks on it are split by these edges.
    bottoms = [
        l
        for l in solid
        if abs(l["top"] - l["bottom"]) < 0.05 and l["x1"] - l["x0"] > 40
    ]
    groups = []
    for ybase, xt in xaxes.items():
        for e in bottoms:
            if abs(e["top"] - ybase) < 0.3:
                xs = sorted(x for x in xt if e["x0"] - 0.3 <= x <= e["x1"] + 0.3)
                if len(xs) >= 3 and (ybase, xs, e["x0"], e["x1"]) not in groups:
                    groups.append((ybase, xs, e["x0"], e["x1"]))
    for ybase, xs, x_left, x_right in groups:
        # The frame's left edge: a long solid stroke up from the bottom line.
        edges = [
            l
            for l in solid
            if abs(l["x0"] - x_left) < 0.3
            and abs(l["x0"] - l["x1"]) < 0.05
            and abs(l["bottom"] - ybase) < 0.3
            and l["bottom"] - l["top"] > 10
        ]
        if not edges:
            continue
        top = min(l["top"] for l in edges)
        # The y ticks on that edge, between the frame's top and bottom.
        ys = sorted(
            y
            for k, v in yaxes.items()
            if abs(k - x_left) < 0.3
            for y in v
            if top - 0.3 <= y <= ybase + 0.3
        )
        if len(ys) < 3:
            continue
        # Calibrate x from the numbers under the ticks.
        xpairs = []
        for x in xs:
            lab = [
                w
                for w in words
                if abs((w["x0"] + w["x1"]) / 2 - x) < 4 and 0 < w["top"] - ybase < 9
            ]
            if lab:
                xpairs.append((x, float(lab[0]["text"])))
        ypairs = []
        for y in ys:
            lab = [
                w
                for w in words
                if 0 < x_left - w["x1"] < 6 and abs((w["top"] + w["bottom"]) / 2 - y) < 3.5
            ]
            if lab:
                ypairs.append((y, float(lab[0]["text"])))
        if len(xpairs) < 3 or len(ypairs) < 3:
            continue
        found.append(
            {
                "page": page.page_number,
                "box": (x_left, top, x_right, ybase),
                "x": fit(xpairs),
                "y": fit(ypairs),
                "xticks": xpairs,
                "yticks": ypairs,
            }
        )

    for ax in found:
        x0, top, x1, ybase = ax["box"]
        # Curves may start left of the frame (clipped there when drawn).
        inside = lambda o: o["x1"] > x0 and o["x0"] < x1 and o["top"] >= top - 2 and o["bottom"] <= ybase + 2
        # Legend samples: short horizontal strokes with a word just to their right.
        legend = {}
        allwords = page.extract_words()
        for l in lines + page.curves:
            if not inside(l) or abs(l["top"] - l["bottom"]) > 0.6 or not 8 < l["x1"] - l["x0"] < 30:
                continue
            y = (l["top"] + l["bottom"]) / 2
            lab = sorted(
                (w for w in allwords if 0 < w["x0"] - l["x1"] < 80 and abs((w["top"] + w["bottom"]) / 2 - y) < 2.2),
                key=lambda w: w["x0"],
            )
            if lab and not NUM.match(lab[0]["text"]) and lab[0]["x0"] - l["x1"] < 12:
                name = " ".join(w["text"] for w in lab)
                # Subscripts (EXPERIMENT_F, _R) sit just right of the name, lower.
                sub = [
                    w
                    for w in allwords
                    if 0 <= w["x0"] - lab[-1]["x1"] < 1.5 and 1 < w["top"] - lab[-1]["top"] < 5
                ]
                if sub:
                    name += "_" + sub[0]["text"]
                legend.setdefault(style(l), name)
        series = {}
        for c in page.curves:
            if inside(c) and len(c["pts"]) > 12:
                pts = [p for p in polyline(c) if x0 - 0.01 <= p[0] <= x1 + 0.01]
                series.setdefault(style(c), []).append(pts)
        ax["legend"] = legend
        ax["series"] = series
    return found


def to_data(ax, pts):
    a, b, _ = ax["x"]
    c, d, _ = ax["y"]
    return [(a * x + b, c * y + d) for x, y in pts]


def describe(pdf_path):
    with pdfplumber.open(pdf_path) as pdf:
        for page in pdf.pages:
            for i, ax in enumerate(axes_on(page)):
                print(
                    f"page {ax['page']} axis {i} box {tuple(round(v) for v in ax['box'])} "
                    f"x {[v for _, v in ax['xticks']]} (worst {ax['x'][2]:.3g}) "
                    f"y {[v for _, v in ax['yticks']]} (worst {ax['y'][2]:.3g})"
                )
                for st, polys in ax["series"].items():
                    n = sum(len(p) for p in polys)
                    print(f"    {st} {ax['legend'].get(st, '?')}: {len(polys)} pieces, {n} points")


def stroke(st):
    """The paper's three strokes: thin solid, thick solid, dashed."""
    width, dash = st
    if dash:
        return "dashed"
    return "thick" if width > 1.1 else "thin"


def main():
    pdf_path = sys.argv[1]
    if sys.argv[2] == "--list":
        describe(pdf_path)
        return
    out = Path(sys.argv[2])
    out.mkdir(parents=True, exist_ok=True)
    spec = json.loads((Path(__file__).parent / "figures.json").read_text())
    with pdfplumber.open(pdf_path) as pdf:
        per_page = {}
        for fig in spec:
            page = fig["page"]
            if page not in per_page:
                per_page[page] = axes_on(pdf.pages[page - 1])
            ax = per_page[page][fig["axis"]]
            for name, wanted in fig["series"].items():
                polys = [p for st, ps in ax["series"].items() if stroke(st) == wanted for p in ps]
                if len(polys) != 1:
                    raise SystemExit(f"{fig['file']}: {len(polys)} {wanted} curves, expected one")
                pts = to_data(ax, polys[0])
                path = out / f"{fig['file']}_{name}.csv"
                with path.open("w", newline="") as f:
                    w = csv.writer(f)
                    w.writerow([fig["x"], fig["y"]])
                    for x, y in pts:
                        w.writerow([f"{x:.5g}", f"{y:.5g}"])
                print(
                    f"{path.name}: {len(pts)} points, x {pts[0][0]:.4g}..{pts[-1][0]:.4g}, "
                    f"calibration within {ax['x'][2]:.2g} / {ax['y'][2]:.2g}"
                )


if __name__ == "__main__":
    main()
