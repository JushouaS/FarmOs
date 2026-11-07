"""Tests for the sensor reader's daily files (dht22_reader.MinuteLogs) and ammonia.py.
python -m unittest test_sensor_files   (from the cerebroil-stream folder; no sensor or GPIO needed)."""
import csv
import tempfile
import unittest
from datetime import datetime
from pathlib import Path

import ammonia
import dht22_reader

PLENTY = lambda _path: 10**12
NOW = datetime(2026, 11, 7, 9, 30).timestamp()


def rows(path):
    with open(path, newline="", encoding="utf-8") as handle:
        return list(csv.DictReader(handle))


class MinuteLogsTest(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.base = Path(tmp.name)
        self.logs = dht22_reader.MinuteLogs(self.base, now=lambda: NOW, free_bytes=PLENTY)

    def read(self, name):
        return rows(self.base / name / f"{name}-2026-11-07.csv")

    def test_a_good_reading_goes_to_two_files_and_ammonia_to_its_own(self):
        self.logs.write({"temperature": 28.4, "humidity": 70.8, "at": NOW - 5}, None, NOW, ammonia_reading=(None, ammonia.NOT_CONNECTED))
        t, h, a = self.read("temperature"), self.read("humidity"), self.read("ammonia")
        self.assertEqual((t[0]["temperature_c"], t[0]["reading_age_s"], t[0]["error"]), ("28.4", "5", ""))
        self.assertEqual((h[0]["humidity_pct"], h[0]["reading_age_s"], h[0]["error"]), ("70.8", "5", ""))
        self.assertEqual((a[0]["ammonia_ppm"], a[0]["error"]), ("", "no ammonia sensor connected"))
        self.assertEqual(list(t[0]), ["time", "temperature_c", "reading_age_s", "error"])
        self.assertEqual(list(h[0]), ["time", "humidity_pct", "reading_age_s", "error"])

    def test_a_failed_read_leaves_both_blank_with_the_reason(self):
        self.logs.write({"temperature": None, "humidity": None, "at": None}, "only 32 of 40 bits arrived", NOW, (None, "x"))
        t, h = self.read("temperature")[0], self.read("humidity")[0]
        self.assertEqual((t["temperature_c"], t["error"]), ("", "only 32 of 40 bits arrived"))
        self.assertEqual((h["humidity_pct"], h["error"]), ("", "only 32 of 40 bits arrived"))

    def test_an_old_value_is_not_repeated_as_new(self):
        self.logs.write({"temperature": 28.4, "humidity": 70.8, "at": NOW - 600}, "the sensor did not answer", NOW, (None, "x"))
        t = self.read("temperature")[0]
        self.assertEqual((t["temperature_c"], t["reading_age_s"]), ("", "600"))

    def test_an_ammonia_value_is_written_when_there_is_one(self):
        self.logs.write({"temperature": None, "humidity": None, "at": None}, "x", NOW, ammonia_reading=(12.5, None))
        self.assertEqual((self.read("ammonia")[0]["ammonia_ppm"], self.read("ammonia")[0]["error"]), ("12.5", ""))


class AmmoniaTest(unittest.TestCase):
    def test_no_sensor_gives_no_number(self):
        self.assertEqual(ammonia.read_ppm(""), (None, "no ammonia sensor connected"))

    def test_an_unknown_sensor_says_so(self):
        ppm, why = ammonia.read_ppm("mq137")
        self.assertIsNone(ppm)
        self.assertIn("not supported yet", why)

    def test_a_supported_sensor_is_checked(self):
        ammonia.READERS["fake"] = lambda: 7.04
        ammonia.READERS["broken"] = lambda: (_ for _ in ()).throw(OSError("i2c error"))
        ammonia.READERS["silly"] = lambda: -3
        try:
            self.assertEqual(ammonia.read_ppm("fake"), (7.0, None))
            self.assertIn("did not answer", ammonia.read_ppm("broken")[1])
            self.assertIn("makes no sense", ammonia.read_ppm("silly")[1])
        finally:
            for k in ("fake", "broken", "silly"):
                ammonia.READERS.pop(k, None)


if __name__ == "__main__":
    unittest.main()
