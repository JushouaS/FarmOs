"""
kinect_log.py: keeps the Kinect's weights on the computer the Kinect is plugged into.

The Live Camera page shows the Kinect weights as they are measured, but nothing used to keep them. kinect_seg.py
now weighs the flock once every KINECT_LOG_SECONDS (default 60) even when nobody is watching, and this writes
what it found into two files a day, with the same power-cut-safe writer as the Pi's daily files (daily_log.py):

    logs/kinect-weights-2026-11-07.csv   one row per reading: how many birds, how many weighed, mean, median,
                                         lightest and heaviest weight, and why a reading had no weights
    logs/kinect-birds-2026-11-07.csv     one row per weighed bird in that reading: its weight, the detector's
                                         confidence, where it was, and the depth measurements the weight came from

No network is needed: the files stay on this computer (copy them, or put LOG_DIR in a synced folder such as
Google Drive). Files older than LOG_KEEP_DAYS (90) are deleted, and nothing is written when the disk is nearly full.

A minute without a weight still gets a row in kinect-weights, with `status` saying why (the bridge is not running,
the Kinect sends no picture, a model is not installed, no birds were seen), so a gap in the record is visible
instead of silent.

Settings (cerebroil-stream/.env on the Kinect computer):
    KINECT_LOG_SECONDS   seconds between saved readings; 0 turns saving off      default 60
    LOG_DIR              where the files go                                    default logs/ beside this file
    LOG_KEEP_DAYS        days of files kept                                    default 90
"""
from __future__ import annotations

import os
import time
from typing import Any

import daily_log

#: "reading" is the moment of the reading in whole seconds since 1970; it ties each bird row to its summary row.
SUMMARY_COLUMNS = ["reading", "status", "birds", "weighed", "mean_g", "median_g", "min_g", "max_g",
                   "error_percent", "message"]
BIRD_COLUMNS = ["reading", "bird", "weight_g", "confidence", "box_x1", "box_y1", "box_x2", "box_y2",
                "area_mm2", "length_mm", "width_mm", "depth_mm"]


def interval_seconds() -> float:
    try:
        return max(0.0, float(os.getenv("KINECT_LOG_SECONDS", "60")))
    except ValueError:
        return 60.0


def should_work(now: float, wanted_until: float, next_log_at: float, every_s: float) -> tuple[bool, bool]:
    """(work this round, save this round). Work while someone watches, or when a saved reading is due."""
    due = every_s > 0 and now >= next_log_at
    return (now <= wanted_until or due), due


class KinectLog:
    def __init__(self, weights: daily_log.DailyCsv | None = None, birds: daily_log.DailyCsv | None = None) -> None:
        self.weights = weights or daily_log.DailyCsv("kinect-weights", SUMMARY_COLUMNS)
        self.birds = birds or daily_log.DailyCsv("kinect-birds", BIRD_COLUMNS)
        self.readings = 0
        self.last_status: str | None = None
        self.last_ok: bool | None = None

    def save(self, result: dict[str, Any], now: float | None = None) -> bool:
        """One reading from kinect_seg (a find_chickens result, or a {"ok": False, "status": ...} one).
        Returns whether the summary row was written."""
        self.readings += 1
        reading = int(result.get("at") or (now if now is not None else time.time()))
        if not result.get("ok"):
            status = result.get("status") or "error"
            row = {"status": status, "message": (result.get("message") or "")[:200]}
        else:
            birds = result.get("birds") or []
            weighed = [b for b in birds if b.get("weightG") is not None]
            grams = sorted(b["weightG"] for b in weighed)
            summary = result.get("weight") or {}
            status = result.get("weightStatus") or ("ok" if grams else "no_birds")
            row = {
                "status": status,
                "birds": len(birds),
                "weighed": len(weighed),
                "mean_g": summary.get("meanG"),
                "median_g": summary.get("medianG"),
                "min_g": grams[0] if grams else None,
                "max_g": grams[-1] if grams else None,
                "error_percent": summary.get("errorPercent"),
            }
            for k, bird in enumerate(weighed, start=1):
                box = bird.get("box") or [None] * 4
                size = bird.get("_size") or {}
                self.birds.append({
                    "reading": reading,
                    "bird": k,
                    "weight_g": bird["weightG"],
                    "confidence": bird.get("confidence"),
                    "box_x1": box[0], "box_y1": box[1], "box_x2": box[2], "box_y2": box[3],
                    "area_mm2": _round(size.get("projected_area_mm2")),
                    "length_mm": _round(size.get("length_mm"), 1),
                    "width_mm": _round(size.get("width_mm"), 1),
                    "depth_mm": _round(size.get("depth_mm")),
                })
        row["reading"] = reading
        written = self.weights.append(row)
        self.last_status = status
        self.last_ok = written
        return written


def _round(value: Any, digits: int = 0) -> Any:
    if value is None:
        return None
    return round(float(value), digits) if digits else int(round(float(value)))
