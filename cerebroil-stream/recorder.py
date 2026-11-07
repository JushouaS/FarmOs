#!/usr/bin/env python3
"""
recorder.py: records the Dahua camera to .mkv files on the Pi's SD card, one hour a day, on a schedule that moves an
hour later each day (for the behaviour footage: the same flock seen at every hour of the morning and early afternoon).

    day 1  RECORD_START_DATE        07:00 to 08:00
    day 2  the next day             08:00 to 09:00
    ...
    day 8                           14:00 to 15:00

    python recorder.py plan      show the schedule and the file names (changes nothing)
    python recorder.py check     verify everything BEFORE the schedule is switched on (see below); exit 0 = all good
    python recorder.py run       wait for each slot and record it (what the cerebroil-recorder service runs)
    python recorder.py status    what has been recorded so far, and what is next

The check (setup-recorder.sh only installs the service when it passes):
  1. ffmpeg is there (the one imageio-ffmpeg brings, or the system's);
  2. the camera link is known (Settings, else DAHUA_RTSP_URL in .env);
  3. the Pi's clock is synchronised and in Asia/Manila, because the slots are wall-clock times;
  4. a 20-second test recording is made and verified: a .mkv file, a real Matroska file (its first bytes), with a
     video stream, and as long as asked for;
  5. the SD card has room for every remaining hour (estimated from the test recording's size), plus 1 GB to spare.

How it records: ffmpeg copies the camera's own video stream into the .mkv without re-encoding it, so it costs the
Pi almost no processor time (the detector keeps it busy enough). Video only: the camera's audio is left out. MKV
on purpose: a file cut short by a power cut still plays up to the cut. If the camera drops out during the hour, the
recorder waits 5 seconds and carries on in a new file (..._part2.mkv) until the hour is over. If the Pi restarts
during a slot, the rest of that slot is recorded. Every hour is then verified the same way as the test, and one row
per slot is added to recordings/recordings-log.csv: planned and actual times, files, size, length, verified, problem.

Files: recordings/day1_2026-11-08_0700-0800.mkv and so on, beside this file (RECORD_DIR changes the folder).

Settings (cerebroil-stream/.env; setup-recorder.sh writes the first three):
    RECORD_START_DATE    the date of day 1, YYYY-MM-DD                      (no default: nothing is recorded without it)
    RECORD_FIRST_HOUR    the hour day 1 starts                              default 7
    RECORD_DAYS          how many days                                       default 8
    RECORD_STEP_HOURS    how much later each day starts                     default 1
    RECORD_MINUTES       how long each recording is                         default 60
    RECORD_DIR           where the files go                                 default recordings/ beside this file
    RECORD_RTSP_URL      a different camera link for recording only         default: the camera service's link
    RECORD_TIMEZONE      the time zone the Pi's clock must be in            default Asia/Manila
"""
from __future__ import annotations

import csv
import io
import json
import os
import re
import shutil
import subprocess
import sys
import time
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Callable

from dotenv import load_dotenv

HERE = Path(__file__).resolve().parent
load_dotenv(HERE / ".env")

MKV_MAGIC = bytes.fromhex("1A45DFA3")      # every Matroska (.mkv) file starts with these four bytes
TEST_SECONDS = 20
RETRY_PAUSE_S = 5
MIN_PART_S = 5                            # less than this left in the hour is not worth a new file
SPARE_BYTES = 1024 ** 3                   # 1 GB left free on the card after all the hours
LOG_COLUMNS = ["day", "planned_start", "planned_end", "files", "started", "ended", "size_mb", "duration_s",
               "verified", "problem"]


# ---------------------------------------------------------------------------
# The schedule
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class Slot:
    day: int
    start: datetime          # local wall-clock time, timezone-aware
    end: datetime

    @property
    def stem(self) -> str:
        return f"day{self.day}_{self.start:%Y-%m-%d}_{self.start:%H%M}-{self.end:%H%M}"

    def label(self) -> str:
        return f"day {self.day}  {self.start:%a %d %b %Y}  {self.start:%H:%M} to {self.end:%H:%M}"


def _int_env(name: str, default: int) -> int:
    try:
        return int(os.getenv(name, str(default)))
    except ValueError:
        return default


def plan(start_date: date, first_hour: int = 7, days: int = 8, step_hours: int = 1, minutes: int = 60) -> list[Slot]:
    """Day 1 at first_hour on start_date, each next day step_hours later. Every slot must end the same day."""
    if days < 1 or minutes < 1:
        raise ValueError("days and minutes must be at least 1")
    slots = []
    for i in range(days):
        midnight = datetime.combine(start_date + timedelta(days=i), datetime.min.time())
        start = midnight + timedelta(hours=first_hour + i * step_hours)
        end = start + timedelta(minutes=minutes)
        if end > midnight + timedelta(days=1):
            raise ValueError(f"day {i + 1} would run past midnight ({start:%H:%M} on day {i + 1} + {minutes} min)")
        slots.append(Slot(i + 1, start.astimezone(), end.astimezone()))
    return slots


def plan_from_env() -> list[Slot]:
    raw = os.getenv("RECORD_START_DATE", "").strip()
    if not raw:
        raise ValueError("RECORD_START_DATE is not set in .env (the date of day 1, YYYY-MM-DD)")
    try:
        start = date.fromisoformat(raw)
    except ValueError as exc:
        raise ValueError(f"RECORD_START_DATE must be YYYY-MM-DD, not {raw!r}") from exc
    return plan(start, _int_env("RECORD_FIRST_HOUR", 7), _int_env("RECORD_DAYS", 8),
                _int_env("RECORD_STEP_HOURS", 1), _int_env("RECORD_MINUTES", 60))


def record_dir() -> Path:
    return Path(os.getenv("RECORD_DIR") or HERE / "recordings")


# ---------------------------------------------------------------------------
# ffmpeg, the camera link, and checking a file
# ---------------------------------------------------------------------------

def find_ffmpeg() -> str | None:
    try:
        import imageio_ffmpeg
        return imageio_ffmpeg.get_ffmpeg_exe()
    except Exception:  # noqa: BLE001 - fall back to the system's
        return shutil.which("ffmpeg")


def camera_url() -> str | None:
    override = os.getenv("RECORD_RTSP_URL", "").strip()
    if override:
        return override
    import camera_config
    return camera_config.read_url()


def redact(url: str) -> str:
    return re.sub(r"(://[^:/@]*:)[^@]*@", r"\1***@", url or "")


def record_command(ffmpeg: str, url: str, seconds: float, out: Path) -> list[str]:
    """Copy the camera's video stream, unchanged, into a Matroska file for `seconds`."""
    return [
        ffmpeg, "-hide_banner", "-nostdin", "-loglevel", "error",
        "-rtsp_transport", "tcp", "-timeout", "15000000",       # give up after 15 s without data from the camera
        "-use_wallclock_as_timestamps", "1",
        "-i", url,
        "-map", "0:v:0", "-c:v", "copy",                         # video only, not re-encoded
        "-t", f"{seconds:.0f}", "-f", "matroska", "-y", str(out),
    ]


@dataclass
class Verified:
    ok: bool
    duration_s: float = 0.0
    size_bytes: int = 0
    problem: str | None = None


def _duration(text: str) -> float | None:
    m = re.search(r"Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)", text)
    return int(m[1]) * 3600 + int(m[2]) * 60 + float(m[3]) if m else None


def verify_mkv(path: Path, expected_s: float | None, ffmpeg: str | None, tolerance: float = 0.9) -> Verified:
    """Is this a real .mkv with a video stream, at least `tolerance` of the expected length?"""
    if path.suffix.lower() != ".mkv":
        return Verified(False, problem=f"{path.name} is not a .mkv file")
    if not path.is_file() or path.stat().st_size == 0:
        return Verified(False, problem=f"{path.name} was not written")
    size = path.stat().st_size
    with open(path, "rb") as handle:
        if handle.read(4) != MKV_MAGIC:
            return Verified(False, size_bytes=size, problem=f"{path.name} is not a Matroska file inside")
    if ffmpeg is None:
        return Verified(False, size_bytes=size, problem="ffmpeg is missing, so the length could not be checked")
    probe = subprocess.run([ffmpeg, "-hide_banner", "-i", str(path)], capture_output=True, text=True, timeout=60)
    text = probe.stderr
    if "matroska" not in text:
        return Verified(False, size_bytes=size, problem=f"ffmpeg does not read {path.name} as Matroska")
    if "Video:" not in text:
        return Verified(False, size_bytes=size, problem=f"{path.name} has no video in it")
    duration = _duration(text)
    if duration is None:
        # A file cut short (power cut, stopped recorder) has no length in its header; measure it instead.
        count = subprocess.run([ffmpeg, "-hide_banner", "-i", str(path), "-map", "0:v:0", "-c", "copy", "-f", "null", "-"],
                               capture_output=True, text=True, timeout=600)
        times = re.findall(r"time=(\d+):(\d+):(\d+(?:\.\d+)?)", count.stderr)
        duration = (int(times[-1][0]) * 3600 + int(times[-1][1]) * 60 + float(times[-1][2])) if times else 0.0
    if expected_s is not None and duration < tolerance * expected_s:
        return Verified(False, duration, size, f"{path.name} is {duration:.0f} s long, expected about {expected_s:.0f} s")
    return Verified(True, duration, size)


# ---------------------------------------------------------------------------
# Recording one slot
# ---------------------------------------------------------------------------

@dataclass
class SlotResult:
    slot: Slot
    files: list[Path] = field(default_factory=list)
    started: datetime | None = None
    ended: datetime | None = None
    duration_s: float = 0.0
    size_bytes: int = 0
    verified: bool = False
    problems: list[str] = field(default_factory=list)


def record_slot(
    slot: Slot,
    url: str,
    ffmpeg: str,
    folder: Path,
    now: Callable[[], datetime] = lambda: datetime.now().astimezone(),
    run: Callable[[list[str], float], int] | None = None,
    sleep: Callable[[float], None] = time.sleep,
    verify: Callable[..., Verified] = verify_mkv,
) -> SlotResult:
    """Record from now (or the slot's start) until its end, carrying on in a new part if the camera drops out."""
    run = run or (lambda cmd, timeout: subprocess.run(cmd, timeout=timeout, capture_output=True).returncode)
    folder.mkdir(parents=True, exist_ok=True)
    result = SlotResult(slot)
    part = 1
    while True:
        remaining = (slot.end - now()).total_seconds()
        if remaining < MIN_PART_S:
            break
        name = f"{slot.stem}.mkv" if part == 1 else f"{slot.stem}_part{part}.mkv"
        out = folder / name
        while out.exists():                       # a restart mid-slot never overwrites what is already recorded
            part += 1
            out = folder / f"{slot.stem}_part{part}.mkv"
        result.started = result.started or now()
        try:
            code = run(record_command(ffmpeg, url, remaining, out), remaining + 120)
        except subprocess.TimeoutExpired:
            code = -1
            result.problems.append(f"part {part} hung and was stopped")
        if out.exists() and out.stat().st_size > 0:
            result.files.append(out)
        left = (slot.end - now()).total_seconds()
        if left < MIN_PART_S:
            break
        result.problems.append(f"the camera dropped out at {now():%H:%M:%S} (ffmpeg exit {code}); carried on in a new file")
        part += 1
        sleep(RETRY_PAUSE_S)
    result.ended = now()

    planned = (slot.end - slot.start).total_seconds()
    covered = (slot.end - (result.started or slot.end)).total_seconds()
    every_file_ok = True
    for f in result.files:
        v = verify(f, None, ffmpeg)
        result.size_bytes += v.size_bytes
        result.duration_s += v.duration_s
        if not v.ok:
            every_file_ok = False
            result.problems.append(v.problem or f"{f.name} did not pass the check")
    if not result.files:
        result.problems.append("nothing was recorded")
    long_enough = result.duration_s >= 0.9 * covered
    if result.files and not long_enough:
        result.problems.append(f"recorded {result.duration_s / 60:.1f} of {covered / 60:.1f} minutes")
    result.verified = bool(result.files) and every_file_ok and long_enough
    if covered < planned - 60:
        result.problems.append(f"started late, at {result.started:%H:%M} (the Pi was off or restarting)")
    return result


def write_log(result: SlotResult, folder: Path) -> None:
    """One row per slot in recordings-log.csv, flushed straight to the card."""
    path = folder / "recordings-log.csv"
    line = io.StringIO()
    writer = csv.writer(line, lineterminator="\n")
    new = not path.exists() or path.stat().st_size == 0
    if new:
        writer.writerow(LOG_COLUMNS)
    writer.writerow([
        result.slot.day, result.slot.start.isoformat(timespec="minutes"), result.slot.end.isoformat(timespec="minutes"),
        "|".join(f.name for f in result.files),
        result.started.isoformat(timespec="seconds") if result.started else "",
        result.ended.isoformat(timespec="seconds") if result.ended else "",
        f"{result.size_bytes / 1024 ** 2:.0f}", f"{result.duration_s:.0f}",
        "yes" if result.verified else "no", "; ".join(result.problems),
    ])
    folder.mkdir(parents=True, exist_ok=True)
    with open(path, "a", encoding="utf-8", newline="") as handle:
        handle.write(line.getvalue())
        handle.flush()
        os.fsync(handle.fileno())


def write_status(folder: Path, data: dict) -> None:
    folder.mkdir(parents=True, exist_ok=True)
    tmp = folder / "status.json.tmp"
    tmp.write_text(json.dumps(data, indent=1), encoding="utf-8")
    os.replace(tmp, folder / "status.json")


# ---------------------------------------------------------------------------
# The check before starting
# ---------------------------------------------------------------------------

def _timedatectl(prop: str) -> str | None:
    try:
        out = subprocess.run(["timedatectl", "show", "-p", prop, "--value"], capture_output=True, text=True, timeout=10)
        return out.stdout.strip() or None
    except (OSError, subprocess.SubprocessError):
        return None


def check() -> int:
    folder = record_dir()
    failures = 0

    def report(ok: bool, text: str) -> None:
        nonlocal failures
        failures += 0 if ok else 1
        print(f"  [{'OK' if ok else 'FAIL'}] {text}")

    print("Checking before the recordings start:")
    try:
        slots = plan_from_env()
    except ValueError as exc:
        report(False, str(exc))
        return 1
    now = datetime.now().astimezone()
    pending = [s for s in slots if s.end > now]
    report(bool(pending), f"schedule: {len(slots)} days, {len(pending)} still to come")

    ffmpeg = find_ffmpeg()
    report(ffmpeg is not None, f"ffmpeg: {ffmpeg or 'not found (pip install imageio-ffmpeg in .venv)'}")
    url = camera_url()
    report(bool(url), f"camera link: {redact(url) if url else 'not set (Settings or DAHUA_RTSP_URL)'}")

    zone_wanted = os.getenv("RECORD_TIMEZONE", "Asia/Manila")
    zone = _timedatectl("Timezone")
    synced = _timedatectl("NTPSynchronized")
    report(zone == zone_wanted, f"time zone: {zone or 'unknown'} (should be {zone_wanted}; "
                                f"fix: sudo timedatectl set-timezone {zone_wanted})")
    report(synced == "yes", f"clock synchronised: {synced or 'unknown'} (the slots start by this clock: {now:%Y-%m-%d %H:%M})")

    if not (ffmpeg and url):
        print("Not recording a test: ffmpeg or the camera link is missing.")
        return 1
    folder.mkdir(parents=True, exist_ok=True)
    test = folder / "test-check.mkv"
    test.unlink(missing_ok=True)
    print(f"  Recording a {TEST_SECONDS}-second test to {test} ...")
    try:
        subprocess.run(record_command(ffmpeg, url, TEST_SECONDS, test), timeout=TEST_SECONDS + 60, capture_output=True)
    except subprocess.TimeoutExpired:
        pass
    v = verify_mkv(test, TEST_SECONDS, ffmpeg)
    report(v.ok, f"test recording: {v.problem or f'a real .mkv with video, {v.duration_s:.1f} s, {v.size_bytes / 1024 ** 2:.1f} MB'}")
    if not v.ok:
        return 1

    per_hour = v.size_bytes / max(v.duration_s, 1) * 3600
    need = sum((s.end - max(s.start, now)).total_seconds() for s in pending) / 3600 * per_hour * 1.2 + SPARE_BYTES
    free = shutil.disk_usage(folder).free
    report(free >= need, f"SD card space: {free / 1024 ** 3:.1f} GB free, about {need / 1024 ** 3:.1f} GB needed "
                         f"(about {per_hour / 1024 ** 3:.2f} GB per hour, plus 20 % and 1 GB to spare)")
    test.unlink(missing_ok=True)

    print("\nThe schedule (the Pi's local time):")
    for s in slots:
        state = "done" if s.end <= now else ("NOW" if s.start <= now else "")
        print(f"  {s.label()}  ->  {folder / (s.stem + '.mkv')}  {state}")
    print("\nAll checks passed." if failures == 0 else f"\n{failures} check(s) failed: fix them, then run the check again.")
    return 0 if failures == 0 else 1


# ---------------------------------------------------------------------------
# The service
# ---------------------------------------------------------------------------

def run_service() -> int:
    folder = record_dir()
    slots = plan_from_env()
    ffmpeg = find_ffmpeg()
    if ffmpeg is None:
        print("recorder: ffmpeg not found")
        return 1
    print(f"recorder: {len(slots)} slots, files in {folder}")
    for slot in slots:
        now = datetime.now().astimezone()
        if slot.end <= now:
            continue
        write_status(folder, {"state": "waiting", "next": slot.label(), "next_start": slot.start.isoformat()})
        while (wait := (slot.start - datetime.now().astimezone()).total_seconds()) > 0:
            time.sleep(min(wait, 60))            # re-read the clock every minute: it may be corrected meanwhile
        url = camera_url()
        if not url:
            print("recorder: no camera link; skipping", slot.label())
            continue
        free = shutil.disk_usage(folder if folder.exists() else HERE).free
        if free < SPARE_BYTES:
            result = SlotResult(slot, problems=[f"only {free / 1024 ** 3:.2f} GB free on the card; not recorded"])
            write_log(result, folder)
            continue
        print(f"recorder: recording {slot.label()}")
        write_status(folder, {"state": "recording", "slot": slot.label(), "until": slot.end.isoformat()})
        result = record_slot(slot, url, ffmpeg, folder)
        write_log(result, folder)
        print(f"recorder: {slot.label()} done, verified={result.verified}, "
              f"{result.duration_s / 60:.1f} min, problems: {'; '.join(result.problems) or 'none'}")
    write_status(folder, {"state": "finished", "slots": len(slots)})
    print("recorder: every slot is done.")
    return 0


def status() -> int:
    folder = record_dir()
    state = folder / "status.json"
    print(state.read_text(encoding="utf-8") if state.exists() else "No status yet (the recorder has not run).")
    log = folder / "recordings-log.csv"
    if log.exists():
        print("\n" + log.read_text(encoding="utf-8"))
    for f in sorted(folder.glob("*.mkv")):
        print(f"  {f.name}  {f.stat().st_size / 1024 ** 2:.0f} MB")
    return 0


def main(argv: list[str]) -> int:
    cmd = argv[1] if len(argv) > 1 else "plan"
    if cmd == "plan":
        for s in plan_from_env():
            print(f"{s.label()}  ->  {record_dir() / (s.stem + '.mkv')}")
        return 0
    if cmd == "check":
        return check()
    if cmd == "run":
        return run_service()
    if cmd == "status":
        return status()
    print(__doc__)
    return 2


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
