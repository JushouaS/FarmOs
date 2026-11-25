"""
Make the weighing-station demo video from Kinect colour clips: the clips joined in time order, the chicken finder
(kinect_seg.find_chickens, the same model as the Live Camera Picture view) run on every frame, its outlines drawn, and
the result slowed down. Nothing is drawn by hand: every outline is the model's output on that frame.

    python make_weight_demo.py --clips "C:/path/to/folder" --out ../gleam-screen-creator-main/demo-day/weight --speed 0.5

Weights are drawn only when the weight model gives them (kinect_weight.WeightModel; KINECT_WEIGHT_MODEL picks the file).
The model that weighs from the colour picture alone (weight_model_coco_rgb_13sessions_hybrid_provisional.json) is not in
git; without it the video shows the outlines and the count, and says the weights are not shown.

Clip names like Live_20261116_203548.mp4 give the date and start time printed on each frame.
Writes <out>/weight_demo.mp4 (mp4v; convert to H.264 for a browser) and <out>/weight_frames.csv (one row per frame).
"""
from __future__ import annotations

import argparse
import csv
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


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--clips", required=True, help="folder of the Kinect colour clips (.mp4)")
    ap.add_argument("--out", required=True)
    ap.add_argument("--speed", type=float, default=0.5, help="playback speed against the recording (0.5 = half speed)")
    args = ap.parse_args()

    clips = sorted(Path(args.clips).glob("*.mp4"), key=lambda p: (clip_start(p) or datetime.min, p.name))
    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)
    weights_on = kinect_seg._weights.available
    note = ("system output, not edited: green = chicken found by the model, weights from the weight model"
            if weights_on else
            "system output, not edited: green = chicken found by the model. Weights not shown: weight model file not installed")
    writer = None
    rows = []
    started = time.time()
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
            when = begin + timedelta(seconds=i / fps) if begin else None
            img = draw(frame, result, when, note)
            if writer is None:
                h, w = img.shape[:2]
                writer = cv2.VideoWriter(str(out_dir / "weight_demo.mp4"), cv2.VideoWriter_fourcc(*"mp4v"), fps * args.speed, (w, h))
            writer.write(img)
            rows.append({"clip": clip.name, "frame": i, "time": when.isoformat() if when else "", "chickens": result["count"],
                         "mean_weight_g": (result.get("weight") or {}).get("meanG", ""), "weight_status": result.get("weightStatus", "")})
            i += 1
        cap.release()
        print(f"{clip.name}: {i} frames")
    if writer:
        writer.release()
    with open(out_dir / "weight_frames.csv", "w", newline="", encoding="utf-8") as fh:
        wr = csv.DictWriter(fh, fieldnames=list(rows[0]))
        wr.writeheader()
        wr.writerows(rows)
    counts = [r["chickens"] for r in rows]
    print(f"{len(rows)} frames from {len(clips)} clips in {time.time() - started:.0f} s; chickens per frame "
          f"median {sorted(counts)[len(counts) // 2]}, range {min(counts)}-{max(counts)}; weights {'on' if weights_on else 'off'}")


if __name__ == "__main__":
    main()
