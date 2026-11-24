import csv
import tempfile
import unittest
from datetime import datetime
from pathlib import Path

import daily_log


class DailyCsvTest(unittest.TestCase):
    def test_appends_rows_and_starts_a_new_file_each_day(self):
        instant = [datetime(2026, 11, 5, 12).timestamp()]
        with tempfile.TemporaryDirectory() as folder:
            log = daily_log.DailyCsv(
                "sensors",
                ["temperature_c", "humidity_pct"],
                Path(folder),
                now=lambda: instant[0],
                free_bytes=lambda _path: 10**12,
            )
            self.assertTrue(log.append({"temperature_c": 28.5, "humidity_pct": 70}))
            instant[0] += 60
            self.assertTrue(log.append({"temperature_c": None, "humidity_pct": None}))
            path = Path(folder) / "sensors-2026-11-05.csv"
            with path.open(newline="", encoding="utf-8") as handle:
                rows = list(csv.reader(handle))
            self.assertEqual(rows[0], ["time", "temperature_c", "humidity_pct"])
            self.assertEqual(rows[1][1:], ["28.5", "70"])
            self.assertEqual(rows[2][1:], ["", ""])

            instant[0] = datetime(2026, 11, 6, 0).timestamp()
            self.assertTrue(log.append({"temperature_c": 29, "humidity_pct": 71}))
            self.assertEqual(
                [item["name"] for item in daily_log.list_files(Path(folder))],
                ["sensors-2026-11-06.csv", "sensors-2026-11-05.csv"],
            )

    def test_rejects_non_log_names_and_skips_a_nearly_full_disk(self):
        self.assertTrue(daily_log.FILE_NAME.fullmatch("behavior-2026-11-05.csv"))
        self.assertFalse(daily_log.FILE_NAME.fullmatch("../.env"))
        with tempfile.TemporaryDirectory() as folder:
            log = daily_log.DailyCsv(
                "sensors",
                ["temperature_c"],
                Path(folder),
                now=lambda: datetime(2026, 11, 5).timestamp(),
                free_bytes=lambda _path: 1024,
            )
            self.assertFalse(log.append({"temperature_c": 28}))
            self.assertEqual(daily_log.list_files(Path(folder)), [])

    def test_folder_logs_are_listed_and_resolved_without_accepting_other_paths(self):
        instant = datetime(2026, 11, 5, 12).timestamp()
        with tempfile.TemporaryDirectory() as folder:
            log = daily_log.DailyCsv(
                "temperature",
                ["temperature_c"],
                Path(folder),
                now=lambda: instant,
                free_bytes=lambda _path: 10**12,
                folder=True,
            )
            self.assertTrue(log.append({"temperature_c": 28.5}))
            relative = "temperature/temperature-2026-11-05.csv"
            files = daily_log.list_files(Path(folder))
            self.assertEqual(files[0]["path"], relative)
            self.assertEqual(
                daily_log.resolve(relative, Path(folder)),
                Path(folder) / relative,
            )
            self.assertIsNone(daily_log.resolve("../temperature-2026-11-05.csv", Path(folder)))
            self.assertIsNone(
                daily_log.resolve("humidity/temperature-2026-11-05.csv", Path(folder))
            )


if __name__ == "__main__":
    unittest.main()
