"""
Reads the measured traces out of the vector plots in Chrstos and Grygier,
"Experimental Testing of a 1994 Ford Taurus for NADSdyna Validation",
SAE 970563 (the copy NHTSA hosts as taurus_test.pdf).

The time histories are read as `digitise.py` reads the Jeep paper's: each
curve is the polyline the plotting program wrote, each axis calibrated from
its tick marks and their numbers by least squares. This paper's ticks are
longer (3.2 to 3.8 pt), so the tick limit is raised.

The ensemble plots draw the ten repeat runs dashed and the mean with its
95 % confidence band in three solid lines; the mean is the middle one. The
frequency responses have a logarithmic frequency axis labelled only at 10^0
and 10^1, so it is calibrated from its minor ticks (1, 2, … 10, 20 rad/s)
instead, and each response is a seven-point polyline.

    python3 -I taurus.py <taurus_test.pdf> <out_dir>

The paper itself is not in the repository (SAE copyright); the CSVs it
writes are, with their source in docs/validation/nhtsa-ford-taurus.md.
Needs pdfplumber.
"""

import csv
from collections import Counter
import math
import sys
from pathlib import Path

import pdfplumber

# -I leaves the script's own directory off the path.
sys.path.insert(0, str(Path(__file__).resolve().parent))
import digitise as dg  # noqa: E402

dg.TICK = 4.0
dg.MIN_POINTS = 5


def write(path, header, rows):
    with path.open("w", newline="") as f:
        w = csv.writer(f)
        w.writerow(header)
        for row in rows:
            w.writerow([f"{v:.5g}" for v in row])
    print(f"{path.name}: {len(rows)} points, x {rows[0][0]:.4g}..{rows[-1][0]:.4g}")


def solid(ax):
    return [p for st, ps in ax["series"].items() if not st[1] for p in ps]


def middle(ax, polys):
    """The middle of the mean and its confidence band, by mean height."""
    if len(polys) != 3:
        raise SystemExit(f"page {ax['page']}: {len(polys)} solid curves, expected three")
    ranked = sorted(polys, key=lambda p: sum(y for _, y in p) / len(p))
    return dg.to_data(ax, ranked[1])


def time_histories(pdf, out):
    def axis(page, i):
        return dg.axes_on(pdf.pages[page - 1])[i]

    # Figure 7: lateral acceleration of one 33 m/s, 6 m/s² J-turn (V0RCX06);
    # dashed raw, solid filtered.
    ax = axis(19, 1)
    (poly,) = solid(ax)
    write(out / "jturn33_ay_exp.csv", ["t", "ay"], dg.to_data(ax, poly))

    # Figure 10: hand-wheel angle of the same J-turn's ten repeats, rad. The
    # solid mean and band overlap so closely that they come out as pieces;
    # the mean is the sample-by-sample median of the solid strokes.
    ax = axis(21, 1)
    pieces = [dg.to_data(ax, p) for p in solid(ax)]
    pts = sorted(pt for p in pieces for pt in p)
    rows = []
    for t, _ in pts:
        if rows and t - rows[-1][0] < 0.01:
            continue
        near = sorted(y for tt, y in pts if abs(tt - t) < 0.005)
        rows.append((t, math.degrees(near[len(near) // 2])))
    write(out / "jturn33_handwheel_exp.csv", ["t", "handwheel_deg"], rows)

    # Figure 11: longitudinal velocity of the same runs.
    ax = axis(22, 0)
    write(out / "jturn33_speed_exp.csv", ["t", "speed"], middle(ax, solid(ax)))

    # Figure 8: lateral acceleration of the 11 m/s, 2 m/s² J-turn (V0RCA),
    # ensemble mean. Its hand-wheel angle is not plotted.
    ax = axis(20, 0)
    write(out / "jturn11_ay_exp.csv", ["t", "ay"], middle(ax, solid(ax)))


def frequency_responses(pdf, out):
    """Figures 14 and 15: three stacked plots each, magnitude, phase, coherence."""
    for page_no, name, unit in [(24, "yawrate", "rad/s per rad"), (25, "ay", "m/s² per rad")]:
        page = pdf.pages[page_no - 1]
        lines = page.lines
        # Frame edges are drawn several times over; a line drawn once at a
        # tick's height across the frame is not one.
        long = Counter(
            round(l["top"], 1)
            for l in lines
            if abs(l["top"] - l["bottom"]) < 0.05 and l["x1"] - l["x0"] > 300
        )
        frames = sorted(y for y, n in long.items() if n >= 3)
        # Frame edges come in top/bottom pairs, top to bottom.
        boxes = [(frames[i], frames[i + 1]) for i in range(0, len(frames) - 1, 2)][:3]
        vt = [l for l in lines if abs(l["x0"] - l["x1"]) < 0.05 and 0.3 < l["bottom"] - l["top"] < 4.5]
        x_left = min(l["x0"] for l in lines if l["x1"] - l["x0"] > 300)
        words = [w for w in page.extract_words() if dg.NUM.match(w["text"])]
        polys = [c for c in page.curves if len(c["pts"]) >= 5]
        for (top, bottom), quantity in zip(boxes, ["mag", "phase", "coherence"]):
            # Log frequency from the minor ticks on the bottom edge: 1 … 10, 20.
            ticks = sorted({round(l["x0"], 2) for l in vt if abs(l["bottom"] - bottom) < 0.3 or abs(l["top"] - bottom) < 0.3})
            values = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 20]
            if len(ticks) != len(values):
                raise SystemExit(f"page {page_no} {quantity}: {len(ticks)} frequency ticks")
            fx = dg.fit([(x, math.log10(v)) for x, v in zip(ticks, values)])
            # Values from the numbers at the left edge, at their own height.
            hticks = sorted(
                {
                    round(l["top"], 2)
                    for l in lines
                    if abs(l["top"] - l["bottom"]) < 0.05
                    and 0.3 < l["x1"] - l["x0"] < 4.5
                    and abs(l["x0"] - x_left) < 0.5
                    and top - 0.3 <= l["top"] <= bottom + 0.3
                }
            )
            pairs = []
            for y in hticks:
                lab = [w for w in words if 0 < x_left - w["x1"] < 8 and abs((w["top"] + w["bottom"]) / 2 - y) < 4]
                if lab:
                    pairs.append((y, float(lab[0]["text"])))
            # The coherence and phase frames carry labelled ticks only at some
            # heights; the frame edges are the axis ends.
            fy = dg.fit(pairs) if len(pairs) >= 2 else None
            if fy is None:
                raise SystemExit(f"page {page_no} {quantity}: {len(pairs)} labelled ticks")
            inside = [c for c in polys if top - 1 <= c["top"] and c["bottom"] <= bottom + 1]
            data = [
                [(10 ** (fx[0] * x + fx[1]), fy[0] * y + fy[1]) for x, y in dg.polyline(c)] for c in inside
            ]
            if quantity == "coherence":
                (rows,) = data
            else:
                if len(data) != 3:
                    raise SystemExit(f"page {page_no} {quantity}: {len(data)} curves")
                rows = sorted(data, key=lambda p: sum(v for _, v in p))[1]
            write(out / f"frf22_{name}_{quantity}.csv", ["omega", quantity], rows)
            print(f"    {unit}; frequency fit within {fx[2]:.2g} decades, value fit within {fy[2]:.2g}")


def main():
    out = Path(sys.argv[2])
    out.mkdir(parents=True, exist_ok=True)
    with pdfplumber.open(sys.argv[1]) as pdf:
        time_histories(pdf, out)
        frequency_responses(pdf, out)


if __name__ == "__main__":
    main()
