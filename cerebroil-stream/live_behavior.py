"""
live_behavior.py: follows the birds on the live camera and tells which are
inactive or huddling.

Every LIVE_SAMPLE_SECONDS it takes the newest frame, runs the trained detector
on it (demo_detect.py) and feeds the boxes to behavior.Engine. The API asks for
the current picture at /behavior/status and raises alerts from it
(packages/api/src/behavior-monitor.ts).

Switched on with LIVE_BEHAVIOR=1 in .env, because it keeps the computer busy
(about one detector run every few seconds). The times are real ones:
LIVE_INACTIVE_SECONDS (default 30 minutes) is how long a bird must stay still, and
LIVE_HUDDLE_SECONDS (default 10 minutes) how long a huddle must last.
"""
from __future__ import annotations

import os
import threading
import time
from typing import Any, Callable

import cv2
import numpy as np

import behavior
import daily_log
import demo_detect
import pixels

SAMPLE_SECONDS = float(os.getenv("LIVE_SAMPLE_SECONDS", "3"))
INACTIVE_SECONDS = float(os.getenv("LIVE_INACTIVE_SECONDS", "1800"))
HUDDLE_SECONDS = float(os.getenv("LIVE_HUDDLE_SECONDS", "600"))
LOG_SECONDS = float(os.getenv("LOG_SECONDS", "60"))


class LiveBehavior:
    def __init__(self, get_frame: Callable[[], bytes | None]) -> None:
        self._get_frame = get_frame
        self._engine = behavior.Engine(
            inactive_seconds=INACTIVE_SECONDS,
            huddle_seconds=HUDDLE_SECONDS,
            keep_all=False,   # a live feed never ends, so finished birds are not kept
        )
        self._lock = threading.Lock()
        self._last_at: float | None = None
        self._error: str | None = None
        self._prev_gray: np.ndarray | None = None   # the previous picture, to see which birds moved
        # A copy of every minute on this Pi's own disk, for when the laptop that stores the snapshots is off (daily_log.py).
        # Counts only, not night or day: the lighting hours are the API's to know, so they are applied when the file is read.
        self._log = daily_log.DailyCsv("behavior", ["birds", "still_birds", "huddled_birds", "flock_moving", "huddle_fdi", "error"])
        self._logged_at = 0.0

    def start(self) -> None:
        threading.Thread(target=self._run, daemon=True, name="live-behavior").start()

    def _run(self) -> None:
        print(f"[behavior] live monitoring on: a frame every {SAMPLE_SECONDS:g} s, "
              f"inactive after {INACTIVE_SECONDS / 60:g} min, huddle after {HUDDLE_SECONDS / 60:g} min.")
        while True:
            started = time.time()
            try:
                self.step()
            except demo_detect.ModelNotInstalled:
                if self._error != "model_not_installed":
                    print("[behavior] the detector model is not installed (models/detector.onnx); live monitoring waits.")
                self._error = "model_not_installed"
                time.sleep(60)
            except Exception as exc:  # keep going: one bad frame must not stop the monitoring
                self._error = f"{type(exc).__name__}: {exc}"[:200]
            self._log_row()
            time.sleep(max(0.5, SAMPLE_SECONDS - (time.time() - started)))

    def _log_row(self) -> None:
        now = time.time()
        if now - self._logged_at < LOG_SECONDS:
            return
        self._logged_at = now
        with self._lock:
            last = self._engine.last
            seen = self._last_at
        fresh = last is not None and seen is not None and now - seen <= max(30.0, 4 * SAMPLE_SECONDS)
        self._log.append({
            "birds": last["n"] if fresh else None,
            "still_birds": sum(1 for s in last["still"] if s) if fresh else None,
            "huddled_birds": sum(1 for h in last["in_huddle"] if h) if fresh else None,
            "flock_moving": round(last["flock_moving"], 3) if fresh and last["flock_moving"] is not None else None,
            "huddle_fdi": round(last["fdi"], 3) if fresh and last.get("fdi") is not None else None,
            "error": self._error,
        })

    def step(self) -> bool:
        """One look at the newest frame. Returns False when there was nothing to look at."""
        data = self._get_frame()
        if not data:
            self._error = "no_frame"
            return False
        frame = cv2.imdecode(np.frombuffer(data, dtype=np.uint8), cv2.IMREAD_COLOR)
        if frame is None:
            self._error = "bad_frame"
            return False
        boxes = demo_detect.detect_frame(frame)
        if boxes is None:            # the detector is busy with an uploaded video
            return False
        height, width = frame.shape[:2]
        gray = pixels.to_gray(frame)
        boxes4 = [b[:4] for b in boxes]
        kept = pixels.unchanged_shares(self._prev_gray, gray, boxes4)
        self._prev_gray = gray
        with self._lock:
            self._engine.update(time.time(), boxes4, float(width * height), kept=kept)
            self._last_at = time.time()
        self._error = None
        return True

    def status(self, night: bool) -> dict[str, Any]:
        """What the API asks for. `night` is whether the lights are off now (the API knows the lighting hours)."""
        with self._lock:
            report = self._engine.status(night)
            last = self._last_at
        report["running"] = last is not None
        report["age_seconds"] = round(time.time() - last, 1) if last is not None else None
        if self._error:
            report["error"] = self._error
        return report
