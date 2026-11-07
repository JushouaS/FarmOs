"""
daily_log.py: one CSV file per day on the Pi, so the readings are kept even when the laptop or the
network is down.

The laptop's database is the main record: the API polls the Pi and stores what it hears. If the laptop is
off, that polling stops and nothing is stored. The sensor reader and the live behaviour monitor therefore
also write their own rows here, one every LOG_SECONDS, and the laptop (or you, over the network) fetches the
files afterwards to fill the gap. The files are plain CSV, so Excel opens them as they are.

One folder per reading, so each can be collected, opened and checked on its own:

    logs/temperature/temperature-2026-11-07.csv
    logs/humidity/humidity-2026-11-07.csv
    logs/ammonia/ammonia-2026-11-07.csv
    logs/behavior/behavior-2026-11-07.csv

Files written before 2026-11-07 (logs/sensors-*.csv with temperature and humidity together, and
logs/behavior-*.csv) stay where they are and are still listed and served.

Written for a computer whose power can be cut at any moment: a row is one short line, flushed and synced as
soon as it is written, and a file whose last line was cut short is closed off before the next row is added.
Never raises: a full or failing disk costs rows, it must not stop the camera service or the sensor reader.

Settings (environment):
    LOG_DIR         where the files go                          default: logs/ beside this file
    LOG_KEEP_DAYS   days of files kept; older ones are deleted   default 90
"""
from __future__ import annotations

import csv
import io
import os
import re
import shutil
import time
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any, Callable

#: The daily files: "<name>-YYYY-MM-DD.csv" and nothing else. The camera service hands these out, and old ones are
#: deleted by this pattern. kinect-weights and kinect-birds are written on the Kinect computer (kinect_log.py);
#: sensors is the old combined temperature-and-humidity file.
FILE_NAME = re.compile(
    r"^(temperature|humidity|ammonia|behavior|sensors|kinect-weights|kinect-birds)-(\d{4})-(\d{2})-(\d{2})\.csv$"
)

#: The readings that have a folder of their own under LOG_DIR.
FOLDERS = ("temperature", "humidity", "ammonia", "behavior")

#: Stop writing when less than this is free, so a full card cannot stop the Pi from booting.
MIN_FREE_BYTES = 200 * 1024 * 1024


def default_dir() -> Path:
    return Path(os.getenv("LOG_DIR") or Path(__file__).with_name("logs"))


def keep_days() -> int:
    try:
        return max(1, int(os.getenv("LOG_KEEP_DAYS", "90")))
    except ValueError:
        return 90


class DailyCsv:
    def __init__(
        self,
        name: str,
        columns: list[str],
        directory: Path | None = None,
        keep: int | None = None,
        now: Callable[[], float] = time.time,
        free_bytes: Callable[[Path], int] | None = None,
        folder: bool = False,
    ) -> None:
        """folder=True writes into a folder named after the reading (LOG_DIR/temperature/...)."""
        self.name = name
        self.columns = ["time", *columns]
        base = directory if directory is not None else default_dir()
        self.directory = base / name if folder else base
        self.keep = keep if keep is not None else keep_days()
        self._now = now
        self._free_bytes = free_bytes or (lambda path: shutil.disk_usage(path).free)
        self._pruned_on: date | None = None

    def path_for(self, ts: float) -> Path:
        return self.directory / f"{self.name}-{datetime.fromtimestamp(ts).date().isoformat()}.csv"

    def append(self, values: dict[str, Any]) -> bool:
        """Adds one row (a blank for any column not given). False when it could not be written."""
        ts = self._now()
        try:
            self.directory.mkdir(parents=True, exist_ok=True)
            if self._free_bytes(self.directory) < MIN_FREE_BYTES:
                return False
            path = self.path_for(ts)
            row = {"time": datetime.fromtimestamp(ts).astimezone().isoformat(timespec="seconds"), **values}
            line = io.StringIO()
            writer = csv.writer(line, lineterminator="\n")
            exists = path.exists() and path.stat().st_size > 0
            if not exists:
                writer.writerow(self.columns)
            writer.writerow(["" if row.get(c) is None else row.get(c) for c in self.columns])
            with open(path, "ab") as handle:
                if exists and not _ends_with_newline(path):
                    handle.write(b"\n")  # a power cut left half a row: close it off, it is skipped when reading
                handle.write(line.getvalue().encode("utf-8"))
                handle.flush()
                os.fsync(handle.fileno())
            self._prune(datetime.fromtimestamp(ts).date())
            return True
        except OSError:
            return False

    def _prune(self, today: date) -> None:
        if self._pruned_on == today:
            return
        self._pruned_on = today
        cutoff = today - timedelta(days=self.keep)
        for path in self.directory.glob(f"{self.name}-*.csv"):
            found = FILE_NAME.match(path.name)
            if not found or found[1] != self.name:   # "kinect-*" must not match a "kinect-birds" file
                continue
            try:
                if date(int(found[2]), int(found[3]), int(found[4])) < cutoff:
                    path.unlink()
            except (ValueError, OSError):
                continue


def _ends_with_newline(path: Path) -> bool:
    with open(path, "rb") as handle:
        handle.seek(-1, os.SEEK_END)
        return handle.read(1) == b"\n"


def list_files(directory: Path | None = None) -> list[dict[str, Any]]:
    """The files that can be fetched, newest day first: name, path (what /logs/<path> takes: "temperature/
    temperature-2026-11-07.csv", or just the name for an old file at the top), folder (None at the top), size in
    bytes, and when each was last written."""
    base = directory if directory is not None else default_dir()
    out = []
    places = [(base, None)] + [(base / f, f) for f in FOLDERS]
    for where, folder in places:
        try:
            entries = list(where.iterdir())
        except OSError:
            continue
        for path in entries:
            found = FILE_NAME.match(path.name)
            if not found or not path.is_file():
                continue
            if folder is not None and found[1] != folder:   # a folder only holds its own reading
                continue
            info = path.stat()
            rel = f"{folder}/{path.name}" if folder else path.name
            out.append({"name": path.name, "path": rel, "folder": folder, "bytes": info.st_size, "modified": info.st_mtime})
    return sorted(out, key=lambda f: (f["name"][-14:-4], f["path"]), reverse=True)


def resolve(path: str, directory: Path | None = None) -> Path | None:
    """The file behind a /logs/<path> request, or None. Only "<file>" (an old file at the top) or
    "<reading>/<reading>-YYYY-MM-DD.csv" is accepted, so nothing else on the Pi can be asked for."""
    base = directory if directory is not None else default_dir()
    parts = path.split("/")
    if len(parts) == 1:
        found = FILE_NAME.match(parts[0])
        target = base / parts[0] if found else None
    elif len(parts) == 2 and parts[0] in FOLDERS:
        found = FILE_NAME.match(parts[1])
        target = base / parts[0] / parts[1] if found and found[1] == parts[0] else None
    else:
        target = None
    return target if target is not None and target.is_file() else None
