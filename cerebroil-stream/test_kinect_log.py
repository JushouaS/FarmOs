"""Tests for kinect_log.py: python -m unittest test_kinect_log   (from the cerebroil-stream folder)."""
import csv
import os
import tempfile
import unittest
from datetime import datetime
from pathlib import Path
from unittest import mock

import daily_log
import kinect_log

PLENTY = lambda _path: 10**12


class Clock:
    def __init__(self, ts):
        self.ts = ts

    def __call__(self):
        return self.ts


def rows(path):
    with open(path, newline="", encoding="utf-8") as handle:
        return list(csv.DictReader(handle))


AT = datetime(2026, 11, 7, 9, 30).timestamp()

GOOD = {
    "ok": True,
    "at": AT,
    "count": 3,
    "birds": [
        {"confidence": 0.91, "box": [0.1, 0.2, 0.3, 0.4], "weightG": 1450,
         "_size": {"projected_area_mm2": 41234.7, "length_mm": 301.26, "width_mm": 170.04, "depth_mm": 1612.4}},
        {"confidence": 0.84, "box": [0.5, 0.5, 0.6, 0.7], "weightG": 1620,
         "_size": {"projected_area_mm2": 45001.2, "length_mm": 320.0, "width_mm": 180.5, "depth_mm": 1600.0}},
        {"confidence": 0.40, "box": [0.8, 0.1, 0.9, 0.2], "weightG": None},   # outline with no usable depth
    ],
    "weightStatus": "ok",
    "weight": {"n": 2, "meanG": 1535, "medianG": 1535, "errorPercent": 18},
}


class KinectLogTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.dir = Path(self.tmp.name)
        clock = Clock(AT)
        self.log = kinect_log.KinectLog(
            daily_log.DailyCsv("kinect-weights", kinect_log.SUMMARY_COLUMNS, self.dir, now=clock, free_bytes=PLENTY),
            daily_log.DailyCsv("kinect-birds", kinect_log.BIRD_COLUMNS, self.dir, now=clock, free_bytes=PLENTY),
        )

    def tearDown(self):
        self.tmp.cleanup()

    def test_a_reading_with_weights(self):
        self.assertTrue(self.log.save(GOOD))
        summary = rows(self.dir / "kinect-weights-2026-11-07.csv")
        self.assertEqual(len(summary), 1)
        s = summary[0]
        self.assertEqual((s["status"], s["birds"], s["weighed"]), ("ok", "3", "2"))
        self.assertEqual((s["mean_g"], s["median_g"], s["min_g"], s["max_g"], s["error_percent"]),
                         ("1535", "1535", "1450", "1620", "18"))
        self.assertEqual(s["reading"], str(int(AT)))
        self.assertTrue(s["time"].startswith("2026-11-07T09:30:00"))

        birds = rows(self.dir / "kinect-birds-2026-11-07.csv")
        self.assertEqual([b["weight_g"] for b in birds], ["1450", "1620"])   # the bird without a weight is left out
        self.assertEqual({b["reading"] for b in birds}, {s["reading"]})
        first = birds[0]
        self.assertEqual((first["bird"], first["confidence"], first["box_x1"], first["box_y2"]), ("1", "0.91", "0.1", "0.4"))
        self.assertEqual((first["area_mm2"], first["length_mm"], first["width_mm"], first["depth_mm"]),
                         ("41235", "301.3", "170.0", "1612"))

    def test_a_failed_reading_is_still_a_row(self):
        self.assertTrue(self.log.save({"ok": False, "status": "bridge_unreachable",
                                       "message": "The Kinect bridge is not answering."}, now=AT))
        s = rows(self.dir / "kinect-weights-2026-11-07.csv")[0]
        self.assertEqual(s["status"], "bridge_unreachable")
        self.assertEqual((s["birds"], s["weighed"], s["mean_g"]), ("", "", ""))   # unknown, not zero
        self.assertIn("not answering", s["message"])
        self.assertFalse((self.dir / "kinect-birds-2026-11-07.csv").exists())
        self.assertEqual(self.log.last_status, "bridge_unreachable")

    def test_no_weight_model_or_no_birds(self):
        self.log.save({"ok": True, "at": AT, "birds": [], "weightStatus": "no_birds", "weight": None})
        self.log.save({"ok": True, "at": AT + 60, "birds": [{"confidence": 0.9, "box": [0, 0, 1, 1], "weightG": None}],
                       "weightStatus": "model_not_installed", "weight": None})
        statuses = [(r["status"], r["birds"], r["weighed"]) for r in rows(self.dir / "kinect-weights-2026-11-07.csv")]
        self.assertEqual(statuses, [("no_birds", "0", "0"), ("model_not_installed", "1", "0")])

    def test_old_files_are_deleted_per_name(self):
        for name in ("kinect-weights-2026-01-01.csv", "kinect-birds-2026-01-01.csv", "sensors-2026-01-01.csv"):
            (self.dir / name).write_text("time\n", encoding="utf-8")
        self.log.save(GOOD)
        left = sorted(p.name for p in self.dir.iterdir())
        self.assertNotIn("kinect-weights-2026-01-01.csv", left)
        self.assertNotIn("kinect-birds-2026-01-01.csv", left)
        self.assertIn("sensors-2026-01-01.csv", left)          # another writer's file is not this writer's business

    def test_full_disk_writes_nothing_and_says_so(self):
        log = kinect_log.KinectLog(
            daily_log.DailyCsv("kinect-weights", kinect_log.SUMMARY_COLUMNS, self.dir, now=Clock(AT), free_bytes=lambda _p: 0),
            daily_log.DailyCsv("kinect-birds", kinect_log.BIRD_COLUMNS, self.dir, now=Clock(AT), free_bytes=lambda _p: 0),
        )
        self.assertFalse(log.save(GOOD))
        self.assertFalse(log.last_ok)
        self.assertEqual(list(self.dir.iterdir()), [])


class ScheduleTest(unittest.TestCase):
    def test_should_work(self):
        # (now, watched until, next saved reading, every) -> (work, save)
        self.assertEqual(kinect_log.should_work(100, 0, 200, 60), (False, False))     # idle
        self.assertEqual(kinect_log.should_work(100, 110, 200, 60), (True, False))    # someone watching
        self.assertEqual(kinect_log.should_work(200, 0, 200, 60), (True, True))       # a saved reading is due
        self.assertEqual(kinect_log.should_work(300, 310, 200, 60), (True, True))     # both
        self.assertEqual(kinect_log.should_work(300, 0, 200, 0), (False, False))      # saving turned off

    def test_interval_setting(self):
        with mock.patch.dict(os.environ, {"KINECT_LOG_SECONDS": "30"}):
            self.assertEqual(kinect_log.interval_seconds(), 30.0)
        with mock.patch.dict(os.environ, {"KINECT_LOG_SECONDS": "nonsense"}):
            self.assertEqual(kinect_log.interval_seconds(), 60.0)
        with mock.patch.dict(os.environ, {"KINECT_LOG_SECONDS": "-5"}):
            self.assertEqual(kinect_log.interval_seconds(), 0.0)


class PageTest(unittest.TestCase):
    def test_measurements_are_not_sent_to_the_page(self):
        try:
            import kinect_seg
        except ImportError as err:      # flask, cv2 or ultralytics missing on this machine
            self.skipTest(str(err))
        kinect_seg._result = GOOD
        body = kinect_seg.app.test_client().get("/latest").get_json()
        self.assertEqual(len(body["birds"]), 3)
        self.assertTrue(all("_size" not in b for b in body["birds"]))
        self.assertIn("_size", GOOD["birds"][0])                     # the saved copy still has them
        health = kinect_seg.app.test_client().get("/health").get_json()
        self.assertIn("saving", health)


if __name__ == "__main__":
    unittest.main()
