"""Tests for daily_log.py: python -m unittest test_daily_log   (from the cerebroil-stream folder; standard library only)."""
import csv
import tempfile
import unittest
from datetime import datetime
from pathlib import Path

import daily_log

PLENTY = lambda _path: 10**12


def stamp(year, month, day, hour=12):
    return datetime(year, month, day, hour).timestamp()


class Clock:
    def __init__(self, ts):
        self.ts = ts

    def __call__(self):
        return self.ts


def rows(path):
    with open(path, newline="", encoding="utf-8") as handle:
        return list(csv.reader(handle))


class DailyCsvTest(unittest.TestCase):
    def make(self, clock, **kw):
        folder = tempfile.TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        log = daily_log.DailyCsv("sensors", ["temperature_c", "humidity_pct"], Path(folder.name), now=clock, free_bytes=kw.pop("free_bytes", PLENTY), **kw)
        return log, Path(folder.name)

    def test_header_once_then_rows(self):
        clock = Clock(stamp(2026, 11, 5))
        log, folder = self.make(clock)
        self.assertTrue(log.append({"temperature_c": 28.4, "humidity_pct": 70.8}))
        clock.ts += 60
        self.assertTrue(log.append({"temperature_c": 28.5, "humidity_pct": 70.1}))
        data = rows(folder / "sensors-2026-11-05.csv")
        self.assertEqual(data[0], ["time", "temperature_c", "humidity_pct"])
        self.assertEqual([r[1:] for r in data[1:]], [["28.4", "70.8"], ["28.5", "70.1"]])
        self.assertRegex(data[1][0], r"^2026-11-05T12:00:00[+-]\d\d:\d\d$")

    def test_a_missing_value_is_left_blank(self):
        log, folder = self.make(Clock(stamp(2026, 11, 5)))
        log.append({"temperature_c": None})
        self.assertEqual(rows(folder / "sensors-2026-11-05.csv")[1][1:], ["", ""])

    def test_a_new_day_starts_a_new_file(self):
        clock = Clock(stamp(2026, 11, 5, 23))
        log, folder = self.make(clock)
        log.append({"temperature_c": 1})
        clock.ts = stamp(2026, 11, 6, 0)
        log.append({"temperature_c": 2})
        self.assertEqual(sorted(f["name"] for f in daily_log.list_files(folder)), ["sensors-2026-11-05.csv", "sensors-2026-11-06.csv"])

    def test_a_row_cut_short_by_a_power_cut_is_closed_off(self):
        log, folder = self.make(Clock(stamp(2026, 11, 5)))
        log.append({"temperature_c": 1, "humidity_pct": 2})
        path = folder / "sensors-2026-11-05.csv"
        with open(path, "ab") as handle:
            handle.write(b"2026-11-05T12:01:00+08:00,28.")  # cut off mid-row, no newline
        log.append({"temperature_c": 3, "humidity_pct": 4})
        lines = path.read_text(encoding="utf-8").split("\n")
        self.assertEqual(lines[-2].split(",")[1:], ["3", "4"])  # the new row is on its own line
        self.assertEqual(lines[-3], "2026-11-05T12:01:00+08:00,28.")

    def test_nothing_is_written_when_the_disk_is_nearly_full(self):
        log, folder = self.make(Clock(stamp(2026, 11, 5)), free_bytes=lambda _p: 1024)
        self.assertFalse(log.append({"temperature_c": 1}))
        self.assertEqual(daily_log.list_files(folder), [])

    def test_a_failing_disk_is_reported_not_raised(self):
        log, folder = self.make(Clock(stamp(2026, 11, 5)))
        (folder / "sensors-2026-11-05.csv").mkdir()  # a folder where the file should be
        self.assertFalse(log.append({"temperature_c": 1}))

    def test_old_files_are_deleted_and_other_files_are_left_alone(self):
        clock = Clock(stamp(2026, 11, 5))
        log, folder = self.make(clock, keep=30)
        for name in ["sensors-2026-09-01.csv", "sensors-2026-10-20.csv", "behavior-2026-09-01.csv", "notes.txt"]:
            (folder / name).write_text("x", encoding="utf-8")
        log.append({"temperature_c": 1})
        left = sorted(p.name for p in folder.iterdir())
        self.assertEqual(left, ["behavior-2026-09-01.csv", "notes.txt", "sensors-2026-10-20.csv", "sensors-2026-11-05.csv"])

    def test_only_log_files_are_listed_or_servable(self):
        for good in ["sensors-2026-11-05.csv", "behavior-2026-01-31.csv", "temperature-2026-11-07.csv",
                     "humidity-2026-11-07.csv", "ammonia-2026-11-07.csv"]:
            self.assertTrue(daily_log.FILE_NAME.match(good), good)
        for bad in ["../.env", "sensors-2026-11-05.csv/..", "dht22.json", "sensors-2026-11-5.csv", "secret-2026-11-05.csv", "sensors-2026-11-05.csv.bak"]:
            self.assertFalse(daily_log.FILE_NAME.match(bad), bad)


class FolderPerReadingTest(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.base = Path(tmp.name)

    def log(self, name, clock, **kw):
        return daily_log.DailyCsv(name, ["value"], self.base, now=clock, free_bytes=PLENTY, folder=True, **kw)

    def test_each_reading_writes_into_its_own_folder(self):
        clock = Clock(stamp(2026, 11, 7))
        for name in ["temperature", "humidity", "ammonia", "behavior"]:
            self.assertTrue(self.log(name, clock).append({"value": 1}))
            self.assertTrue((self.base / name / f"{name}-2026-11-07.csv").is_file(), name)

    def test_listing_shows_the_folders_and_the_older_files_at_the_top(self):
        clock = Clock(stamp(2026, 11, 7))
        self.log("temperature", clock).append({"value": 28})
        (self.base / "sensors-2026-11-05.csv").write_text("x", encoding="utf-8")
        (self.base / "temperature" / "notes.txt").write_text("x", encoding="utf-8")
        (self.base / "temperature" / "humidity-2026-11-07.csv").write_text("x", encoding="utf-8")  # wrong folder
        listed = [(f["path"], f["folder"]) for f in daily_log.list_files(self.base)]
        self.assertEqual(listed, [("temperature/temperature-2026-11-07.csv", "temperature"), ("sensors-2026-11-05.csv", None)])

    def test_only_a_reading_file_in_its_own_folder_can_be_fetched(self):
        clock = Clock(stamp(2026, 11, 7))
        self.log("humidity", clock).append({"value": 70})
        (self.base / "sensors-2026-11-05.csv").write_text("x", encoding="utf-8")
        (self.base / ".env").write_text("SECRET=1", encoding="utf-8")
        self.assertEqual(daily_log.resolve("humidity/humidity-2026-11-07.csv", self.base),
                         self.base / "humidity" / "humidity-2026-11-07.csv")
        self.assertEqual(daily_log.resolve("sensors-2026-11-05.csv", self.base), self.base / "sensors-2026-11-05.csv")
        for bad in ["../.env", ".env", "humidity/../.env", "temperature/humidity-2026-11-07.csv",
                    "humidity/humidity-2026-11-08.csv", "secret/secret-2026-11-07.csv", "a/b/humidity-2026-11-07.csv",
                    "humidity-2026-11-07.csv"]:
            self.assertIsNone(daily_log.resolve(bad, self.base), bad)

    def test_old_files_in_a_folder_are_deleted(self):
        clock = Clock(stamp(2026, 11, 7))
        (self.base / "ammonia").mkdir()
        (self.base / "ammonia" / "ammonia-2026-01-01.csv").write_text("x", encoding="utf-8")
        self.log("ammonia", clock, keep=30).append({"value": None})
        self.assertEqual(sorted(p.name for p in (self.base / "ammonia").iterdir()), ["ammonia-2026-11-07.csv"])


if __name__ == "__main__":
    unittest.main()
