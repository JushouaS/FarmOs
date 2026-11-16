"""time_detector.py: how long one detector run takes on this computer, on the live camera's newest picture.

    .venv/bin/python time_detector.py

The live monitor (live_behavior.py) can look at most once per detector run, plus some room for the camera stream and
the recorder. Prints the median time of 10 runs and the shortest LIVE_SAMPLE_SECONDS worth setting.
"""
from __future__ import annotations

import os
import statistics
import sys
import time

import cv2
import numpy as np
from dotenv import load_dotenv

load_dotenv()
import demo_detect  # noqa: E402


def newest_picture() -> np.ndarray:
    """One JPEG from the camera service's MJPEG stream (standard library only: the Pi's .venv has no requests)."""
    from urllib.request import Request, urlopen

    token = os.getenv("VISION_SERVICE_TOKEN", "")
    port = os.getenv("FLASK_PORT", "5000")
    req = Request(f"http://127.0.0.1:{port}/stream/dahua", headers={"X-Vision-Token": token})
    with urlopen(req, timeout=10) as res:
        buf = b""
        while len(buf) < 20_000_000:
            chunk = res.read(65536)
            if not chunk:
                break
            buf += chunk
            start = buf.find(b"\xff\xd8")
            end = buf.find(b"\xff\xd9", start + 2) if start != -1 else -1
            if end != -1:
                return cv2.imdecode(np.frombuffer(buf[start:end + 2], np.uint8), cv2.IMREAD_COLOR)
    raise RuntimeError("no picture from the camera service")


def live_monitor_running() -> bool:
    """True when the camera service (which runs the live monitor's detector) is up: the two then share the CPU."""
    import subprocess

    try:
        return subprocess.run(["systemctl", "is-active", "--quiet", "cerebroil-stream"], timeout=5).returncode == 0
    except (OSError, subprocess.SubprocessError):
        return False


def main() -> int:
    if live_monitor_running():
        print("Note: the camera service is running, so the live monitor's detector shares the CPU with this test and "
              "the time below is slower than the detector alone. For the detector's own time: "
              "sudo systemctl stop cerebroil-stream, run this again, then sudo systemctl start cerebroil-stream.")
    try:
        frame = newest_picture()
    except Exception as exc:  # noqa: BLE001
        print(f"Could not get a camera picture ({exc}); timing on a grey test picture instead.")
        frame = np.full((1080, 1920, 3), 120, np.uint8)
    times = []
    for _ in range(10):
        started = time.perf_counter()
        boxes = demo_detect.detect_frame(frame, 0.1, 0.7)
        if boxes is None:
            print("The detector is busy (the live monitor holds it); the times include waiting.")
            time.sleep(0.2)
            continue
        times.append(time.perf_counter() - started)
    if not times:
        print("No run finished.")
        return 1
    median = statistics.median(times[1:] or times)
    print(f"picture {frame.shape[1]}x{frame.shape[0]}, {len(boxes)} boxes, one detector run: {median:.2f} s "
          f"(median of {len(times)})")
    print(f"shortest sensible LIVE_SAMPLE_SECONDS: {max(1.0, round(median * 1.6 + 0.5, 1)):g}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
