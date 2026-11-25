"""
The Live Camera "Analyze data" scan, run ahead of time on a recording, for the demo video.

The scan on the farm is three analysis passes of the camera picture one second apart (the API keeps the middle one by
movement). This runs the camera service's own analysis (app._build_analysis: frame difference + the trained detector +
huddle groups) on the recording's frames instead of the camera's, one pass per second, and writes the scan the page
would have got at every second of the clip. In demo mode the page shows the scan for the second the video is at.
Nothing goes to the database.

    python make_scan_demo.py --source ../gleam-screen-creator-main/demo-day/src/day5_1130-1145.mkv \
        --start "2026-11-12T11:30:00+08:00" --out ../gleam-screen-creator-main/public/demo/behavior_scans.json
"""
from __future__ import annotations

import argparse
import json
import time
from datetime import datetime, timedelta

import cv2

import app as camera_service


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--source", required=True)
    ap.add_argument("--start", required=True, help="wall-clock time of the recording's first frame (ISO 8601)")
    ap.add_argument("--out", required=True)
    args = ap.parse_args()
    start = datetime.fromisoformat(args.start)

    cap = cv2.VideoCapture(args.source)
    fps = cap.get(cv2.CAP_PROP_FPS) or 30
    seconds = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) / fps)
    frame: dict[str, bytes | None] = {"jpg": None}
    camera_service._resolve_camera = lambda _cid: "dahua"
    camera_service._latest_frame_bytes = lambda _src: frame["jpg"]

    passes = []
    began = time.time()
    for s in range(seconds):
        cap.set(cv2.CAP_PROP_POS_MSEC, s * 1000)
        ok, img = cap.read()
        if not ok:
            break
        frame["jpg"] = cv2.imencode(".jpg", img, [cv2.IMWRITE_JPEG_QUALITY, 90])[1].tobytes()
        passes.append(camera_service._build_analysis("CAM-01"))   # movement compares with the previous second's picture
        if s % 60 == 0:
            print(f"  {s // 60} min done ({time.time() - began:.0f} s)")

    scans = []
    for s in range(1, len(passes) - 2):   # the first pass has no earlier picture to compare with
        three = passes[s:s + 3]
        mv = [p["behaviour"]["movement_index"] for p in three]
        chosen = sorted(three, key=lambda p: p["behaviour"]["movement_index"])[1]
        scans.append({
            **{k: v for k, v in chosen.items() if k != "detections"},
            "detections": [],
            "recorded_at": (start + timedelta(seconds=s)).isoformat(),
            "scan": {"samples": 3, "movement_min": min(mv), "movement_max": max(mv), "movement_mean": round(sum(mv) / 3, 4)},
        })
    out = {"source": args.source.replace("\\", "/").split("/")[-1], "start": args.start, "first_second": 1, "scans": scans}
    with open(args.out, "w", encoding="utf-8") as fh:
        json.dump(out, fh, separators=(",", ":"))
    models = {p.get("detector", {}).get("source") for p in passes}
    print(f"{len(scans)} scans from {len(passes)} passes in {time.time() - began:.0f} s; detector: {models}")


if __name__ == "__main__":
    main()
