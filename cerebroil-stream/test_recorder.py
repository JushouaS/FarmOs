"""Tests for recorder.py: python -m unittest test_recorder   (from the cerebroil-stream folder).
The .mkv checks use real files made with ffmpeg (imageio-ffmpeg); no camera is needed."""
import csv
import subprocess
import tempfile
import unittest
from datetime import date, datetime, timedelta
from pathlib import Path

import recorder

FFMPEG = recorder.find_ffmpeg()


def make_video(path: Path, seconds: int, fmt: str = "matroska") -> Path:
    subprocess.run([FFMPEG, "-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i",
                    f"testsrc=duration={seconds}:size=160x120:rate=5", "-c:v", "mpeg4", "-f", fmt, str(path)],
                   check=True, timeout=60)
    return path


class PlanTest(unittest.TestCase):
    def test_eight_days_an_hour_later_each_day(self):
        slots = recorder.plan(date(2026, 11, 8))
        self.assertEqual(len(slots), 8)
        got = [(s.day, f"{s.start:%Y-%m-%d %H:%M}", f"{s.end:%H:%M}") for s in slots]
        self.assertEqual(got[0], (1, "2026-11-08 07:00", "08:00"))
        self.assertEqual(got[1], (2, "2026-11-09 08:00", "09:00"))
        self.assertEqual(got[2], (3, "2026-11-10 09:00", "10:00"))
        self.assertEqual(got[7], (8, "2026-11-15 14:00", "15:00"))
        self.assertEqual(slots[0].stem, "day1_2026-11-08_0700-0800")
        self.assertTrue(all(s.start.tzinfo is not None for s in slots))

    def test_a_slot_past_midnight_is_refused(self):
        with self.assertRaises(ValueError):
            recorder.plan(date(2026, 11, 8), first_hour=20, days=8)
        self.assertEqual(len(recorder.plan(date(2026, 11, 8), first_hour=16, days=8)), 8)  # last one 23:00 to 00:00

    def test_the_start_date_must_be_set(self):
        import os
        old = os.environ.pop("RECORD_START_DATE", None)
        try:
            with self.assertRaises(ValueError):
                recorder.plan_from_env()
            os.environ["RECORD_START_DATE"] = "8 Nov"
            with self.assertRaises(ValueError):
                recorder.plan_from_env()
        finally:
            os.environ.pop("RECORD_START_DATE", None)
            if old is not None:
                os.environ["RECORD_START_DATE"] = old

    def test_the_command_copies_video_into_matroska(self):
        cmd = recorder.record_command("ffmpeg", "rtsp://u:p@cam/x", 3600, Path("a.mkv"))
        self.assertEqual(cmd[cmd.index("-c:v") + 1], "copy")
        self.assertEqual(cmd[cmd.index("-f") + 1], "matroska")
        self.assertEqual(cmd[cmd.index("-t") + 1], "3600")
        self.assertEqual(cmd[-1], "a.mkv")
        self.assertEqual(recorder.redact("rtsp://admin:secret@192.168.0.101:554/x"), "rtsp://admin:***@192.168.0.101:554/x")


@unittest.skipIf(FFMPEG is None, "ffmpeg is not installed here")
class VerifyTest(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.dir = Path(tmp.name)

    def test_a_real_mkv_passes(self):
        v = recorder.verify_mkv(make_video(self.dir / "ok.mkv", 4), 4, FFMPEG)
        self.assertTrue(v.ok, v.problem)
        self.assertAlmostEqual(v.duration_s, 4, delta=0.5)
        self.assertGreater(v.size_bytes, 0)

    def test_the_wrong_kind_of_file_fails(self):
        mp4 = make_video(self.dir / "clip.mkv", 2, fmt="mp4")          # an MP4 with a .mkv name
        self.assertIn("not a Matroska file", recorder.verify_mkv(mp4, 2, FFMPEG).problem)
        right_inside = make_video(self.dir / "clip.mp4", 2)
        self.assertIn("not a .mkv file", recorder.verify_mkv(right_inside, 2, FFMPEG).problem)
        self.assertIn("was not written", recorder.verify_mkv(self.dir / "missing.mkv", 2, FFMPEG).problem)

    def test_too_short_fails(self):
        v = recorder.verify_mkv(make_video(self.dir / "short.mkv", 2), 20, FFMPEG)
        self.assertFalse(v.ok)
        self.assertIn("expected about 20 s", v.problem)

    def test_a_file_cut_short_is_still_measured(self):
        whole = make_video(self.dir / "whole.mkv", 6)
        cut = self.dir / "cut.mkv"
        cut.write_bytes(whole.read_bytes()[: whole.stat().st_size * 2 // 3])   # like a power cut mid-recording
        v = recorder.verify_mkv(cut, None, FFMPEG)
        self.assertTrue(v.ok, v.problem)
        self.assertGreater(v.duration_s, 1)


class Clock:
    def __init__(self, t: datetime):
        self.t = t

    def __call__(self):
        return self.t


def fake_verify(path, expected, ffmpeg):
    seconds = float(path.read_text(encoding="utf-8"))
    return recorder.Verified(True, seconds, 1000)


class RecordSlotTest(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.dir = Path(tmp.name)
        self.slot = recorder.plan(date(2026, 11, 8))[0]          # 07:00 to 08:00

    def runner(self, clock, plan):
        """plan: per ffmpeg run, how many seconds it records before stopping (None = the whole -t)."""
        calls = []

        def run(cmd, timeout):
            asked = float(cmd[cmd.index("-t") + 1])
            got = asked if not plan else (plan.pop(0) or asked)
            Path(cmd[-1]).write_text(str(got), encoding="utf-8")
            clock.t += timedelta(seconds=got)
            calls.append(cmd)
            return 0 if got == asked else 1
        return run, calls

    def record(self, clock, plan=None):
        run, calls = self.runner(clock, list(plan or []))
        result = recorder.record_slot(self.slot, "rtsp://cam", "ffmpeg", self.dir, now=clock, run=run,
                                      sleep=lambda s: setattr(clock, "t", clock.t + timedelta(seconds=s)),
                                      verify=fake_verify)
        return result, calls

    def test_a_whole_hour_in_one_file(self):
        result, calls = self.record(Clock(self.slot.start))
        self.assertEqual([f.name for f in result.files], ["day1_2026-11-08_0700-0800.mkv"])
        self.assertEqual(len(calls), 1)
        self.assertTrue(result.verified)
        self.assertEqual(result.problems, [])

    def test_a_dropout_carries_on_in_a_second_file(self):
        result, calls = self.record(Clock(self.slot.start), plan=[1200])      # the camera drops out after 20 min
        self.assertEqual([f.name for f in result.files],
                         ["day1_2026-11-08_0700-0800.mkv", "day1_2026-11-08_0700-0800_part2.mkv"])
        self.assertTrue(any("dropped out" in p for p in result.problems))
        self.assertTrue(result.verified)                                       # 59 min 55 s of 60 recorded
        self.assertAlmostEqual(result.duration_s, 3595, delta=1)

    def test_a_restart_mid_slot_records_the_rest_without_overwriting(self):
        (self.dir / "day1_2026-11-08_0700-0800.mkv").write_text("1500", encoding="utf-8")   # from before the restart
        result, _ = self.record(Clock(self.slot.start + timedelta(minutes=30)))
        self.assertEqual([f.name for f in result.files], ["day1_2026-11-08_0700-0800_part2.mkv"])
        self.assertEqual((self.dir / "day1_2026-11-08_0700-0800.mkv").read_text(encoding="utf-8"), "1500")
        self.assertTrue(any("started late, at 07:30" in p for p in result.problems))

    def test_nothing_recorded_is_not_verified(self):
        clock = Clock(self.slot.start)

        def run(cmd, timeout):
            clock.t = self.slot.end              # ffmpeg hung until the end and wrote nothing
            return 1
        result = recorder.record_slot(self.slot, "rtsp://cam", "ffmpeg", self.dir, now=clock, run=run,
                                      sleep=lambda s: None, verify=fake_verify)
        self.assertFalse(result.verified)
        self.assertIn("nothing was recorded", result.problems)

    def test_the_log_gets_one_row_per_slot(self):
        result, _ = self.record(Clock(self.slot.start))
        recorder.write_log(result, self.dir)
        recorder.write_log(result, self.dir)
        with open(self.dir / "recordings-log.csv", newline="", encoding="utf-8") as handle:
            rows = list(csv.DictReader(handle))
        self.assertEqual(len(rows), 2)
        self.assertEqual((rows[0]["day"], rows[0]["verified"], rows[0]["files"]), ("1", "yes", "day1_2026-11-08_0700-0800.mkv"))
        self.assertTrue(rows[0]["planned_start"].startswith("2026-11-08T07:00"))


if __name__ == "__main__":
    unittest.main()
