"""
Builds size_calibration.json: the scale that turns a bird's size in the picture into grams, for each camera position.

    python tools/build_size_calibration.py --frames C:/Users/Jush/Downloads/rgb --out size_calibration.json

Why one scale per camera position: a picture gives a bird's size in pixels, and the grams-per-pixel scale depends on how high
the camera is. Measured on the project's own colour frames (Day 24 to Day 40, one overhead camera): the scale is steady within a
camera position (Day 26 to Day 40: within about +/-7 %, day by day) but about three times different between Day 25 and Day 26,
when the camera was moved. So each position gets its own scale, and a video's position is recognised from its background
(the picture with the moving birds removed), which is compared with the stored reference backgrounds.

The scale is learned against the breed standard (Ross 308, the curve stored in the project's database), taking the flock to have
been at the standard on those days. It is a calibration, not a weighing: a flock that was really heavier or lighter than the
standard on those days shifts the scale. Rebuild it from weighed birds when there are some.

A bird's size is (box area, rescaled to 1280x720) ** 1.5, the box of a bird that overlaps nothing and touches no edge.
"""
from __future__ import annotations

import argparse
import base64
import collections
import glob
import json
import os
import re
import sys

import cv2
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
import weight  # noqa: E402
from detector import Detector  # noqa: E402

#: Breed standard (g) by grow-out day, as stored in the project's database; days between are on the straight line.
STANDARD = {1: 60, 7: 190, 14: 460, 21: 900, 22: 971, 23: 1043, 28: 1400, 35: 1950, 42: 2422}


def standard_g(day: int) -> float:
    pts = sorted(STANDARD.items())
    for (d0, g0), (d1, g1) in zip(pts, pts[1:]):
        if d0 <= day <= d1:
            return g0 + (g1 - g0) * (day - d0) / (d1 - d0)
    raise ValueError(day)


def parse_setups(text: str) -> dict[str, tuple[int, int]]:
    out = {}
    for part in text.split(","):
        name, span = part.split(":")
        lo, hi = span.split("-")
        out[name] = (int(lo), int(hi))
    return out


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--frames", required=True, help="folder of DayNN_YYYYMMDD_HHMMSS_rgb.png frames")
    ap.add_argument("--out", default=os.path.join(os.path.dirname(HERE), "size_calibration.json"))
    ap.add_argument("--setups", default="A:24-25,B:26-40", help="camera positions as NAME:first-last grow-out day")
    ap.add_argument("--per-day", type=int, default=25, help="frames measured per day")
    args = ap.parse_args()
    setups = parse_setups(args.setups)

    groups = collections.defaultdict(list)
    for f in sorted(glob.glob(os.path.join(args.frames, "Day*_rgb.png"))):
        m = re.match(r"Day(\d+)_(\d{8})_", os.path.basename(f))
        groups[(int(m[1]), m[2])].append(f)
    days: dict[int, list[str]] = {}
    for (day, _), files in groups.items():
        if len(files) >= 50 and (day not in days or len(files) > len(days[day])):
            days[day] = files

    detector = Detector()
    if not detector.available:
        sys.exit(f"The detector is not available: {detector.load_error}")

    per_day = {}
    for day in sorted(days):
        files = days[day]
        pick = [files[int(i)] for i in np.linspace(0, len(files) - 1, args.per_day)]
        sizes, backgrounds = [], []
        for n, f in enumerate(pick):
            img = cv2.imread(f, cv2.IMREAD_COLOR)
            boxes = [(d.box_x, d.box_y, d.box_w, d.box_h) for d in detector.detect(img)]
            h, w = img.shape[:2]
            res = weight.size_weights(boxes, (w, h), 1000.0)
            iso = [weight.size_unit(b, (w, h)) for b, r in zip(boxes, res["birds"]) if r["reliable"]]
            if iso:
                sizes.append(float(np.mean(iso)))
            if n % 2 == 0 and len(backgrounds) < 12:
                backgrounds.append(img)
        per_day[day] = {
            "mean_size": float(np.median(sizes)),
            "background": weight.background_signature(backgrounds),
        }
        print(f"day {day}: mean size {per_day[day]['mean_size']:,.0f}, standard {standard_g(day):.0f} g", flush=True)

    result = {"reference_resolution": list(weight.REFERENCE_FRAME), "setups": {}}
    for name, (lo, hi) in setups.items():
        members = [d for d in per_day if lo <= d <= hi]
        ks = [standard_g(d) / per_day[d]["mean_size"] for d in members]
        k = float(np.median(ks))
        print(f"setup {name} (days {lo}-{hi}): scale {k:.3e} g per size unit; by day spread {100 * np.std(ks) / np.mean(ks):.1f}%")
        result["setups"][name] = {
            "days": [lo, hi],
            "grams_per_size_unit": k,
            "scale_spread_percent": round(float(100 * np.std(ks) / np.mean(ks)), 1),
            "scale_by_day": {str(d): round(float(kk), 8) for d, kk in zip(members, ks)},
            "backgrounds": [_encode(per_day[d]["background"]) for d in members],
        }
    with open(args.out, "w", encoding="utf-8") as fh:
        json.dump(result, fh, indent=1)
    print("written", args.out)


def _encode(sig: np.ndarray) -> str:
    ok, buf = cv2.imencode(".png", sig)
    return base64.b64encode(buf.tobytes()).decode("ascii")


if __name__ == "__main__":
    main()
