"""
Run the bird tracker over a video, and score it against hand-made ground truth.

    # 1. Track a clip: one sampled frame every 2 s, like klydel's runner.
    python tools/track_clip.py predict --source clip.mp4 --out pred.txt --csv birds.csv

    # 2. Score it against ground truth annotated on the SAME sampled frames
    #    (MOTChallenge text, e.g. CVAT "MOT 1.1" export; frame N = sample N).
    python tools/track_clip.py score --gt gt.txt --pred pred.txt

`predict` options:
  --tracker hybrid      ByteTrack + klydel's stable IDs and recovery (default)
  --tracker bytetrack   ByteTrack alone, for comparison
  --conf 0.1            detector confidence floor; ByteTrack's low band starts at 0.1
  --interval 2.0        seconds between sampled frames
  --max-seconds N       stop after N seconds of video

Without ground truth, `predict` still prints how stable the numbers were:
how many distinct IDs were handed out for how many birds, and how long they
lasted. A tracker that keeps birds well hands out few IDs that live long.
Nothing here reads or writes the database.
"""
from __future__ import annotations

import argparse
import csv
import os
import statistics
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))


def sample_frames(source: str, interval: float, max_seconds: float | None = None):
    """(t seconds, sample number from 1, frame), one frame every `interval`
    seconds of video time, as klydel's common.sample_frames does it."""
    import cv2

    cap = cv2.VideoCapture(source)
    if not cap.isOpened():
        raise SystemExit(f"Cannot open {source}")
    fps = cap.get(cv2.CAP_PROP_FPS)
    if fps <= 0:
        raise SystemExit("Could not read the video's frame rate.")
    step = max(1, round(fps * interval))
    i = n = 0
    try:
        while cap.grab():
            if i % step == 0:
                t = i / fps
                if max_seconds is not None and t > max_seconds:
                    break
                ok, frame = cap.retrieve()
                if ok:
                    n += 1
                    yield t, n, frame
            i += 1
    finally:
        cap.release()


def predict(args) -> None:
    # The detector reads its settings when imported, so set the floor first.
    os.environ["CHICKEN_CONF_MIN"] = str(args.conf)
    if args.model:
        os.environ["CHICKEN_MODEL_PATH"] = args.model
    from bytetrack import BYTETracker, ByteTrackConfig
    from detector import Detector
    from mot_metrics import write_mot
    from stable_ids import KLYDEL_COMMIT, BroilerTracker, HybridConfig, tuned_for

    detector = Detector()
    if not detector.available:
        raise SystemExit(f"No detector: {detector.load_error}. Use --model path/to/chicken.onnx")

    bt_cfg = ByteTrackConfig.from_env()
    if args.tracker == "hybrid":
        # TRACK_REFIND_SECONDS=0 scores klydel's tracker exactly.
        bt_cfg, hy_cfg = tuned_for(args.interval, bt_cfg, HybridConfig.from_env())
        tracker = BroilerTracker(bt_cfg, hy_cfg)
    else:
        tracker = BYTETracker(bt_cfg)
    print(f"Tracker: {args.tracker} ({bt_cfg}); stable-ID layer from klydel {KLYDEL_COMMIT}")

    rows, table = [], []
    first_seen: dict[int, float] = {}
    last_seen: dict[int, float] = {}
    birds_per_frame: list[int] = []
    recovered_total = 0
    started = time.monotonic()
    for t, n, frame in sample_frames(args.source, args.interval, args.max_seconds):
        dets = [(d.box_x + d.box_w / 2, d.box_y + d.box_h / 2, d.box_w, d.box_h, d.confidence)
                for d in detector.detect(frame)]
        if args.tracker == "hybrid":
            out = [(b.stable_id, b.box, b.score, b.recovered) for b in tracker.update(dets)]
        else:
            out = [(o.track_id, o.box, o.score, False) for o in tracker.update(dets)]
        birds_per_frame.append(len(out))
        for tid, (cx, cy, w, h), score, recovered in out:
            rows.append((n, tid, cx - w / 2, cy - h / 2, w, h, score))
            table.append([f"{t:.3f}", n, tid, f"{cx:.2f}", f"{cy:.2f}", f"{w:.2f}", f"{h:.2f}",
                          f"{score:.4f}", int(recovered), len(dets)])
            first_seen.setdefault(tid, t)
            last_seen[tid] = t
            recovered_total += int(recovered)
        if n % 30 == 0:
            print(f"[{t:8.1f}s] frame {n}: {len(dets)} detections, {len(out)} tracked, "
                  f"{len(first_seen)} IDs so far ({time.monotonic() - started:.0f}s)")

    write_mot(args.out, rows)
    if args.csv:
        with open(args.csv, "w", newline="", encoding="utf-8") as fh:
            w = csv.writer(fh)
            w.writerow(["t_s", "frame_no", "track_id", "cx", "cy", "w", "h", "score", "recovered", "n_detections"])
            w.writerows(table)

    frames = len(birds_per_frame)
    if not frames:
        print("No frames were read.")
        return
    mean_birds = statistics.mean(birds_per_frame)
    lifetimes = sorted(last_seen[k] - first_seen[k] for k in first_seen)
    print(f"\n{frames} frames, {len(first_seen)} distinct IDs, {mean_birds:.1f} birds per frame on average")
    if mean_birds:
        print(f"IDs handed out per bird in view: {len(first_seen) / mean_birds:.2f} (1.00 = nobody renumbered)")
    if lifetimes:
        print(f"ID lifetime: median {statistics.median(lifetimes):.0f}s, longest {lifetimes[-1]:.0f}s; "
              f"{sum(1 for x in lifetimes if x >= 1800)} IDs lasted 30 min or more")
    if args.tracker == "hybrid":
        print(f"Boxes given back by recovery: {recovered_total}")
    print(f"Saved {args.out}" + (f" and {args.csv}" if args.csv else ""))


def score(args) -> None:
    from mot_metrics import TARGETS, evaluate, read_mot

    s = evaluate(read_mot(args.gt), read_mot(args.pred), iou_thr=args.iou_thr)
    result = s.as_dict()
    width = max(len(k) for k in result)
    for k, v in result.items():
        target = TARGETS.get(k)
        mark = "" if target is None else ("  meets target" if v >= target else f"  below target {target}")
        print(f"{k:<{width}}  {v}{mark}")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)

    p = sub.add_parser("predict", help="track a video and write MOTChallenge predictions")
    p.add_argument("--source", required=True)
    p.add_argument("--out", default="pred.txt")
    p.add_argument("--csv", default="", help="also write one row per tracked bird per frame")
    p.add_argument("--model", default="", help="ONNX detector (default: CHICKEN_MODEL_PATH or models/chicken.onnx)")
    p.add_argument("--tracker", choices=["hybrid", "bytetrack"], default="hybrid")
    p.add_argument("--interval", type=float, default=2.0)
    p.add_argument("--conf", type=float, default=0.1)
    p.add_argument("--max-seconds", type=float, default=None)
    p.set_defaults(fn=predict)

    s = sub.add_parser("score", help="MOTA, MOTP, IDF1 and ID switches against ground truth")
    s.add_argument("--gt", required=True)
    s.add_argument("--pred", required=True)
    s.add_argument("--iou-thr", type=float, default=0.5)
    s.set_defaults(fn=score)

    args = ap.parse_args()
    if args.cmd == "predict" and args.interval <= 0:
        ap.error("--interval must be positive")
    args.fn(args)


if __name__ == "__main__":
    main()
