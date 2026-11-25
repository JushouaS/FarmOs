"""
Make the weighing-station demo video from Kinect colour clips: the clips joined in time order, the chicken finder
(kinect_seg.find_chickens, the same model as the Live Camera Picture view) run on every frame, its outlines drawn, and
the result slowed down. Nothing is drawn by hand: every outline is the model's output on that frame.

    python make_weight_demo.py --clips "C:/path/to/folder" --out ../gleam-screen-creator-main/demo-day/weight --speed 0.5

Weights come from the weight model when it gives them on these pictures (kinect_weight.WeightModel). The models that
need the Kinect depth picture cannot weigh a colour-only clip, so then a size estimate is drawn instead and labelled as
one: each bird's outline area to the power 1.5, times one scale for all clips, set so the clips' median bird matches the
Ross 308 standard for the birds' age (--age-anchor). Birds cut off by the picture's edge get no weight.

Clip names like Live_20261116_203548.mp4 give the date and start time printed on each frame.
Writes <out>/weight_demo.mp4 (mp4v; convert to H.264 for a browser) and <out>/weight_frames.csv (one row per frame).
"""
from __future__ import annotations

import argparse
import csv
import json
import re
import time
from datetime import datetime, timedelta
from pathlib import Path

import cv2
import numpy as np

import kinect_seg

GREEN = (90, 200, 90)
FONT = cv2.FONT_HERSHEY_SIMPLEX


def clip_start(path: Path) -> datetime | None:
    m = re.search(r"(\d{8})_(\d{6})", path.stem)
    return datetime.strptime(m.group(1) + m.group(2), "%Y%m%d%H%M%S") if m else None


def draw(frame: np.ndarray, result: dict, when: datetime | None, note: str) -> np.ndarray:
    h, w = frame.shape[:2]
    out = frame.copy()
    fill = frame.copy()
    for b in result["birds"]:
        pts = (np.asarray(b["polygon"], dtype=np.float32) * [w, h]).astype(np.int32)
        cv2.fillPoly(fill, [pts], GREEN)
        cv2.polylines(out, [pts], True, GREEN, 3, cv2.LINE_AA)
        if b.get("weightG") is not None:
            x, y = pts[:, 0].min(), pts[:, 1].min()
            label = f"{b['weightG'] / 1000:.2f} kg"
            (tw, th), _ = cv2.getTextSize(label, FONT, 0.8, 2)
            cv2.rectangle(out, (x, y - th - 10), (x + tw + 10, y), GREEN, -1)
            cv2.putText(out, label, (x + 5, y - 6), FONT, 0.8, (0, 0, 0), 2, cv2.LINE_AA)
    out = cv2.addWeighted(fill, 0.22, out, 0.78, 0)
    # top banner: station, time, count (and the mean weight when there is one)
    cv2.rectangle(out, (0, 0), (w, 56), (20, 20, 20), -1)
    head = f"CAM-02 Weighing station   chickens found: {result['count']}"
    mean = (result.get("weight") or {}).get("meanG")
    if mean:
        head += f"   mean weight: {mean / 1000:.2f} kg"
    cv2.putText(out, head, (16, 38), FONT, 1.0, (255, 255, 255), 2, cv2.LINE_AA)
    if when:
        stamp = when.strftime("%d %b %Y  %H:%M:%S")
        (tw, _), _ = cv2.getTextSize(stamp, FONT, 1.0, 2)
        cv2.putText(out, stamp, (w - tw - 16, 38), FONT, 1.0, (255, 255, 255), 2, cv2.LINE_AA)
    cv2.rectangle(out, (0, h - 36), (w, h), (20, 20, 20), -1)
    cv2.putText(out, note, (16, h - 11), FONT, 0.7, (220, 220, 220), 1, cv2.LINE_AA)
    return out


# Ross 308 target weight by day of age (grams), as stored in cycle_weights.standard_g; linear between points.
ROSS_308 = [(1, 60), (7, 190), (14, 460), (21, 900), (22, 971), (23, 1043), (25, 1186), (28, 1400), (34, 1871), (35, 1950), (42, 2422)]


def ross308(day: float) -> float:
    for (d0, g0), (d1, g1) in zip(ROSS_308, ROSS_308[1:]):
        if d0 <= day <= d1:
            return g0 + (g1 - g0) * (day - d0) / (d1 - d0)
    return float(ROSS_308[-1][1] if day > ROSS_308[-1][0] else ROSS_308[0][1])


def size_units(result: dict, w: int, h: int) -> list[float | None]:
    """Outline area to the power 1.5 for each whole, separate bird; None (no weight) for an outline that is cut off by the
    picture's edge, that mostly overlaps another outline (a piece of a bird outlined twice), or that is under half the
    frame's typical outline (a fragment). The outline is still drawn; only the weight is left off."""
    birds = result["birds"]
    areas, boxes = [], []
    for b in birds:
        pts = np.asarray(b["polygon"], dtype=np.float64) * [w, h]
        areas.append(abs(float(np.dot(pts[:, 0], np.roll(pts[:, 1], 1)) - np.dot(pts[:, 1], np.roll(pts[:, 0], 1)))) / 2)
        x0, y0, x1, y1 = b["box"]
        boxes.append((x0 * w, y0 * h, x1 * w, y1 * h))
    whole = [a for a, (x0, y0, x1, y1) in zip(areas, boxes) if x0 > 0.01 * w and y0 > 0.01 * h and x1 < 0.99 * w and y1 < 0.99 * h]
    typical = float(np.median(whole)) if whole else 0.0
    out: list[float | None] = []
    for i, (area, (x0, y0, x1, y1)) in enumerate(zip(areas, boxes)):
        if x0 <= 0.01 * w or y0 <= 0.01 * h or x1 >= 0.99 * w or y1 >= 0.99 * h or area <= 0 or area < 0.5 * typical:
            out.append(None)
            continue
        own = max((x1 - x0) * (y1 - y0), 1.0)
        overlap = max((max(0.0, min(x1, X1) - max(x0, X0)) * max(0.0, min(y1, Y1) - max(y0, Y0)) / own
                       for j, (X0, Y0, X1, Y1) in enumerate(boxes) if j != i), default=0.0)
        out.append(None if overlap > 0.5 else area ** 1.5)
    return out


def drop_drinkers(result: dict, zones: list) -> int:
    """Remove outlines whose box lies mostly (over 60 %) inside a marked drinker zone, grown by 15 % each way. Returns how
    many were removed; the count is updated."""
    if not zones:
        return 0
    grown = []
    for x0, y0, x1, y1 in zones:
        dx, dy = (x1 - x0) * 0.15, (y1 - y0) * 0.15
        grown.append((x0 - dx, y0 - dy, x1 + dx, y1 + dy))
    keep = []
    for b in result["birds"]:
        bx0, by0, bx1, by1 = b["box"]
        own = max((bx1 - bx0) * (by1 - by0), 1e-9)
        inside = max(max(0.0, min(bx1, x1) - max(bx0, x0)) * max(0.0, min(by1, y1) - max(by0, y0)) / own for x0, y0, x1, y1 in grown)
        if inside <= 0.6:
            keep.append(b)
    removed = len(result["birds"]) - len(keep)
    result["birds"] = keep
    result["count"] = len(keep)
    return removed


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--clips", required=True, help="folder of the Kinect colour clips (.mp4)")
    ap.add_argument("--out", required=True)
    ap.add_argument("--speed", type=float, default=0.5, help="playback speed against the recording (0.5 = half speed)")
    ap.add_argument("--zones", help="JSON of drinker zones per clip name (demo_drinker_zones.json); outlines mostly inside one are dropped")
    ap.add_argument("--age-anchor", default="2026-11-17:35",
                    help="DATE:DAY, a date and the birds' age that day; used for the size estimate's breed-standard scale")
    args = ap.parse_args()

    clips = sorted(Path(args.clips).glob("*.mp4"), key=lambda p: (clip_start(p) or datetime.min, p.name))
    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)
    anchor_date, anchor_day = args.age_anchor.split(":")
    anchor = datetime.strptime(anchor_date, "%Y-%m-%d")
    age = lambda when: int(anchor_day) + (when.date() - anchor.date()).days

    zones = json.loads(Path(args.zones).read_text(encoding="utf-8")) if args.zones else {}
    dropped = 0

    # Pass 1: the model on every frame.
    started = time.time()
    frames = []
    for clip in clips:
        cap = cv2.VideoCapture(str(clip))
        fps = cap.get(cv2.CAP_PROP_FPS) or 10
        begin = clip_start(clip)
        i = 0
        while True:
            ok, frame = cap.read()
            if not ok:
                break
            ok, jpg = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, 92])
            result = kinect_seg.find_chickens(jpg.tobytes())
            dropped += drop_drinkers(result, zones.get(clip.name, []))
            h, w = frame.shape[:2]
            frames.append({"clip": clip, "i": i, "fps": fps, "when": begin + timedelta(seconds=i / fps) if begin else None,
                           "result": result, "units": size_units(result, w, h)})
            i += 1
        cap.release()
        print(f"{clip.name}: {i} frames")

    # The weight model when it works on these pictures; otherwise the size estimate with one scale for every clip.
    model_weights = any((f["result"].get("weight") or {}).get("meanG") for f in frames)
    scale = None
    if not model_weights:
        ratios = []
        for f in frames:
            u = [x for x in f["units"] if x]
            if len(u) >= 3 and f["when"]:
                ratios.append(ross308(age(f["when"])) / float(np.median(u)))
        scale = float(np.median(ratios)) if ratios else None
        for f in frames:
            for b, u in zip(f["result"]["birds"], f["units"]):
                b["weightG"] = round(u * scale) if (u and scale) else None
            ws = [b["weightG"] for b in f["result"]["birds"] if b["weightG"]]
            f["result"]["weight"] = {"meanG": round(float(np.mean(ws))), "n": len(ws)} if ws else None
    days = sorted({age(f["when"]) for f in frames if f["when"]})
    note = ("Green: chicken found by the model. Weights from the weight model." if model_weights else
            f"Green: chicken found by the model (drinkers left out). Weights: size estimate scaled to Ross 308, "
            f"Days {days[0]}-{days[-1]}. A rough guide, not a scale weighing.")

    # Pass 2: draw and write.
    writer = None
    rows = []
    for f in frames:
        cap_frame = None
        rows.append(f)
    by_clip: dict[Path, list] = {}
    for f in frames:
        by_clip.setdefault(f["clip"], []).append(f)
    out_rows = []
    for clip, fl in by_clip.items():
        cap = cv2.VideoCapture(str(clip))
        for f in fl:
            ok, frame = cap.read()
            if not ok:
                break
            img = draw(frame, f["result"], f["when"], note)
            if writer is None:
                h, w = img.shape[:2]
                writer = cv2.VideoWriter(str(out_dir / "weight_demo.mp4"), cv2.VideoWriter_fourcc(*"mp4v"), f["fps"] * args.speed, (w, h))
            writer.write(img)
            out_rows.append({"clip": clip.name, "frame": f["i"], "time": f["when"].isoformat() if f["when"] else "",
                             "age_day": age(f["when"]) if f["when"] else "", "chickens": f["result"]["count"],
                             "weighed": (f["result"].get("weight") or {}).get("n", ""),
                             "mean_weight_g": (f["result"].get("weight") or {}).get("meanG", "")})
        cap.release()
    if writer:
        writer.release()
    with open(out_dir / "weight_frames.csv", "w", newline="", encoding="utf-8") as fh:
        wr = csv.DictWriter(fh, fieldnames=list(out_rows[0]))
        wr.writeheader()
        wr.writerows(out_rows)
    counts = [r["chickens"] for r in out_rows]
    print(f"{len(out_rows)} frames from {len(clips)} clips in {time.time() - started:.0f} s; chickens per frame median "
          f"{sorted(counts)[len(counts) // 2]}, range {min(counts)}-{max(counts)}; "
          f"drinker outlines dropped: {dropped}; weights: {'model' if model_weights else f'size estimate, scale {scale:.3e} g per unit'}")
    by_day: dict[int, list] = {}
    for r in out_rows:
        if r["mean_weight_g"] != "":
            by_day.setdefault(r["age_day"], []).append(r["mean_weight_g"])
    for d in sorted(by_day):
        print(f"  Day {d}: frame mean weight median {np.median(by_day[d]):.0f} g (Ross 308 {ross308(d):.0f} g), {len(by_day[d])} frames")


if __name__ == "__main__":
    main()
