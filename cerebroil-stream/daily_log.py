"""Durable per-day CSV logs kept locally on the Raspberry Pi."""
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

FILE_NAME = re.compile(
    r"^(temperature|humidity|ammonia|behavior|sensors|kinect-weights|kinect-birds)-"
    r"(\d{4})-(\d{2})-(\d{2})\.csv$"
)
SET_ASIDE = re.compile(
    r"^(temperature|humidity|ammonia|behavior|sensors|kinect-weights|kinect-birds)-"
    r"(\d{4})-(\d{2})-(\d{2})\.before-\d{6}\.csv$"
)
FOLDERS = ("temperature", "humidity", "ammonia", "behavior")
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
        self.name = name
        self.columns = ["time", *columns]
        base = directory if directory is not None else default_dir()
        self.directory = base / name if folder else base
        self.keep = keep if keep is not None else keep_days()
        self._now = now
        self._free_bytes = free_bytes or (lambda path: shutil.disk_usage(path).free)
        self._pruned_on: date | None = None
        self._checked: set[Path] = set()

    def path_for(self, ts: float) -> Path:
        return self.directory / f"{self.name}-{datetime.fromtimestamp(ts).date().isoformat()}.csv"

    def append(self, values: dict[str, Any]) -> bool:
        """Append one row; return False if storage is unavailable or nearly full."""
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
            if exists and path not in self._checked:
                exists = self._set_aside_if_columns_changed(path, ts)
            self._checked.add(path)
            if not exists:
                writer.writerow(self.columns)
            writer.writerow(["" if row.get(column) is None else row.get(column) for column in self.columns])
            with open(path, "ab") as handle:
                if exists and not _ends_with_newline(path):
                    handle.write(b"\n")
                handle.write(line.getvalue().encode("utf-8"))
                handle.flush()
                os.fsync(handle.fileno())
            self._prune(datetime.fromtimestamp(ts).date())
            return True
        except OSError:
            return False

    def _set_aside_if_columns_changed(self, path: Path, ts: float) -> bool:
        with open(path, "r", encoding="utf-8", errors="replace", newline="") as handle:
            first = handle.readline().rstrip("\r\n")
        if first == ",".join(self.columns):
            return True
        stamp = datetime.fromtimestamp(ts).strftime("%H%M%S")
        path.rename(path.with_name(f"{path.stem}.before-{stamp}.csv"))
        return False

    def _prune(self, today: date) -> None:
        if self._pruned_on == today:
            return
        self._pruned_on = today
        cutoff = today - timedelta(days=self.keep)
        for path in self.directory.glob(f"{self.name}-*.csv"):
            found = FILE_NAME.match(path.name) or SET_ASIDE.match(path.name)
            if not found:
                continue
            try:
                if found[1] == self.name and date(int(found[2]), int(found[3]), int(found[4])) < cutoff:
                    path.unlink()
            except (ValueError, OSError):
                continue


def _ends_with_newline(path: Path) -> bool:
    with open(path, "rb") as handle:
        handle.seek(-1, os.SEEK_END)
        return handle.read(1) == b"\n"


def list_files(directory: Path | None = None) -> list[dict[str, Any]]:
    """Return the daily logs that can be downloaded, newest first."""
    base = directory if directory is not None else default_dir()
    out = []
    places = [(base, None)] + [(base / name, name) for name in FOLDERS]
    for folder, kind in places:
        try:
            entries = list(folder.iterdir())
        except OSError:
            continue
        for path in entries:
            found = FILE_NAME.fullmatch(path.name)
            if not found or not path.is_file():
                continue
            if kind is not None and found[1] != kind:
                continue
            info = path.stat()
            relative = f"{kind}/{path.name}" if kind else path.name
            out.append(
                {
                    "name": path.name,
                    "path": relative,
                    "folder": kind,
                    "bytes": info.st_size,
                    "modified": info.st_mtime,
                }
            )
    return sorted(out, key=lambda item: (item["name"][-14:-4], item["path"]), reverse=True)


def resolve(path: str, directory: Path | None = None) -> Path | None:
    """Resolve only a supported flat log name or one supported log subfolder."""
    base = directory if directory is not None else default_dir()
    parts = path.split("/")
    if len(parts) == 1 and FILE_NAME.fullmatch(parts[0]):
        target = base / parts[0]
    elif (
        len(parts) == 2
        and parts[0] in FOLDERS
        and FILE_NAME.fullmatch(parts[1])
        and parts[1].startswith(f"{parts[0]}-")
    ):
        target = base / parts[0] / parts[1]
    else:
        return None
    return target if target.is_file() else None
