"""Tests for behavior_log.py (the readable behaviour rows) and for a file whose columns change mid-day.
python -m unittest test_behavior_log   (from the cerebroil-stream folder; no camera or model needed)."""
import csv
import tempfile
import unittest
from datetime import datetime
from pathlib import Path

import behavior_log
import daily_log

PLENTY = lambda _path: 10**12


def last(n, still, in_huddle, fdi=0.0, moving=None):
    return {"n": n, "still": still, "in_huddle": in_huddle, "fdi": fdi, "flock_moving": moving}


def row(*args, **kw):
    return behavior_log.row(*args, still_window_s=1800, huddle_window_s=600, **kw)


class RowTest(unittest.TestCase):
    def test_too_early_to_judge(self):
        r = row(last(25, [None] * 25, [False] * 25), True, None)
        self.assertEqual(r["summary"], "25 birds seen; too early to say which are still (a bird needs 30 min of watching); no huddle.")
        self.assertEqual((r["birds_seen"], r["still_birds"], r["birds_judged"], r["moving_pct"]), (25, 0, 0, None))
        self.assertEqual((r["still_window_min"], r["huddle_window_min"], r["problem"]), (30, 10, None))

    def test_still_birds_and_a_huddle(self):
        still = [True, True] + [False] * 21 + [None, None]
        huddle = [True] * 4 + [False] * 21
        r = row(last(25, still, huddle, fdi=0.16, moving=0.913), True, None)
        self.assertEqual(r["summary"], "25 birds seen; 2 still for 30+ min (of 23 watched long enough); 4 in a huddle (16% of the flock).")
        self.assertEqual((r["still_birds"], r["birds_judged"], r["huddled_birds"], r["huddled_pct"], r["moving_pct"]), (2, 23, 4, 16, 91))

    def test_a_big_huddle_is_called_out(self):
        r = row(last(10, [False] * 10, [True] * 4 + [False] * 6, fdi=0.4, moving=0.9), True, None)
        self.assertIn("4 in a huddle (40% of the flock), above the 35% warning level", r["summary"])
        self.assertIn("none still for 30+ min", r["summary"])

    def test_one_bird_and_no_birds(self):
        self.assertTrue(row(last(1, [None], [False]), True, None)["summary"].startswith("1 bird seen;"))
        self.assertEqual(row(last(0, [], []), True, None)["summary"], "No birds seen.")

    def test_no_reading_says_why_in_words(self):
        r = row(None, False, "no_frame")
        self.assertEqual((r["summary"], r["problem"]), ("No reading this minute.", "The camera gave no picture."))
        self.assertIsNone(r.get("birds_seen"))        # unknown, not zero
        self.assertEqual(row(None, False, "model_not_installed")["problem"],
                         "The bird detector is not installed (models/detector.onnx).")
        self.assertEqual(row(None, False, None)["problem"], "No new picture was checked in the last minute.")
        self.assertEqual(row(None, False, "RuntimeError: boom")["problem"], "Error: RuntimeError: boom")

    def test_every_column_is_known(self):
        r = row(last(3, [True, False, None], [False] * 3, moving=0.5), True, None)
        self.assertEqual(set(r) - set(behavior_log.COLUMNS), set())


class ColumnsChangeTest(unittest.TestCase):
    def test_a_file_with_old_columns_is_set_aside_and_a_new_one_started(self):
        with tempfile.TemporaryDirectory() as tmp:
            base = Path(tmp)
            folder = base / "behavior"
            folder.mkdir()
            old = folder / "behavior-2026-11-07.csv"
            old.write_text("time,birds,still_birds\n2026-11-07T19:02:39+08:00,25,0\n", encoding="utf-8")
            ts = datetime(2026, 11, 7, 19, 30, 5).timestamp()
            log = daily_log.DailyCsv("behavior", behavior_log.COLUMNS, base, now=lambda: ts, free_bytes=PLENTY, folder=True)
            self.assertTrue(log.append(row(None, False, "no_frame")))
            self.assertTrue(log.append(row(None, False, "no_frame")))
            with open(old, newline="", encoding="utf-8") as handle:
                rows = list(csv.reader(handle))
            self.assertEqual(rows[0], ["time", *behavior_log.COLUMNS])
            self.assertEqual(len(rows), 3)                       # header + the two new rows
            kept = folder / "behavior-2026-11-07.before-193005.csv"
            self.assertTrue(kept.read_text(encoding="utf-8").startswith("time,birds,still_birds"))
            self.assertEqual([f["name"] for f in daily_log.list_files(base)], ["behavior-2026-11-07.csv"])  # set-aside not served

    def test_set_aside_files_are_deleted_with_the_old_ones(self):
        with tempfile.TemporaryDirectory() as tmp:
            base = Path(tmp)
            (base / "behavior").mkdir()
            (base / "behavior" / "behavior-2026-01-01.before-120000.csv").write_text("x", encoding="utf-8")
            ts = datetime(2026, 11, 7, 12).timestamp()
            daily_log.DailyCsv("behavior", ["a"], base, keep=30, now=lambda: ts, free_bytes=PLENTY, folder=True).append({"a": 1})
            self.assertEqual(sorted(p.name for p in (base / "behavior").iterdir()), ["behavior-2026-11-07.csv"])


if __name__ == "__main__":
    unittest.main()
