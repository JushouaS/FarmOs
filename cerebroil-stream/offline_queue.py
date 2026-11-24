"""Durable CSV queue for camera analyses awaiting delivery to the farm API."""
from __future__ import annotations

import csv
import json
import os
import sqlite3
import threading
import time
import urllib.error
import urllib.request
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable

QUEUE_PATH = Path(os.getenv("OFFLINE_QUEUE_CSV", str(Path(__file__).with_name("analysis_queue.csv"))))
LEGACY_QUEUE_PATH = QUEUE_PATH.with_name("offline_queue.sqlite3")
MAX_EVENTS = max(1, int(os.getenv("OFFLINE_QUEUE_MAX_EVENTS", "10000")))
SAMPLE_SECONDS = max(30.0, float(os.getenv("OFFLINE_SAMPLE_SECONDS", "300")))
SYNC_SECONDS = max(5.0, float(os.getenv("OFFLINE_SYNC_SECONDS", "15")))
SYNC_URL = os.getenv("OFFLINE_SYNC_URL", "").strip()
REQUIRE_MODEL = os.getenv("OFFLINE_REQUIRE_MODEL", "1") != "0"
CAMERAS = tuple(
    camera.strip()
    for camera in os.getenv("OFFLINE_QUEUE_CAMERAS", "CAM-01,KINECT-01").split(",")
    if camera.strip()
)
BATCH_SIZE = 20
CSV_FIELDS = (
    "event_id",
    "camera_id",
    "event_at",
    "detector_json",
    "behavior_json",
    "detection_count",
    "detections_json",
    "weight_json",
    "clusters_json",
    "analysis_json",
    "sync_status",
)


class QueueFullError(RuntimeError):
    """The configured queue limit was reached; existing records were preserved."""


def camera_is_configured(camera_id: str) -> bool:
    if camera_id != "KINECT-01":
        return True
    source = os.getenv("KINECT_SOURCE", "simulated").strip()
    return source.isdigit() or source.startswith(("rtsp://", "http://", "/dev/video"))


def is_model_result(camera_id: str, analysis: dict) -> bool:
    return camera_id != "CAM-01" or analysis.get("detector", {}).get("source") == "model"


def _encode(value: object) -> str:
    return json.dumps(value, separators=(",", ":"), allow_nan=False)


def _csv_row(event: dict) -> dict[str, str]:
    analysis = event["analysis"]
    return {
        "event_id": event["event_id"],
        "camera_id": event["camera_id"],
        "event_at": event["event_at"],
        "detector_json": _encode(analysis.get("detector")),
        "behavior_json": _encode(analysis.get("behaviour", analysis.get("behavior"))),
        "detection_count": str(analysis.get("detection_count", len(analysis.get("detections") or []))),
        "detections_json": _encode(analysis.get("detections", [])),
        "weight_json": _encode(analysis.get("weight")),
        "clusters_json": _encode(analysis.get("clusters", [])),
        "analysis_json": _encode(analysis),
        "sync_status": "pending",
    }


def _event_from_row(row: dict[str, str]) -> dict:
    try:
        analysis = json.loads(row["analysis_json"])
        event = {
            "event_id": row["event_id"],
            "camera_id": row["camera_id"],
            "event_at": row["event_at"],
            "analysis": analysis,
        }
    except (KeyError, json.JSONDecodeError) as exc:
        raise ValueError(f"invalid row in offline queue CSV: {exc}") from exc
    if not isinstance(analysis, dict):
        raise ValueError("invalid row in offline queue CSV: analysis_json is not an object")
    return event


class OfflineQueue:
    def __init__(self, path: Path = QUEUE_PATH, max_events: int = MAX_EVENTS) -> None:
        self.path = Path(path)
        self.max_events = max_events
        self._lock = threading.RLock()
        self.path.parent.mkdir(parents=True, exist_ok=True)
        if not self.path.exists():
            with self.path.open("w", newline="", encoding="utf-8") as file:
                writer = csv.DictWriter(file, fieldnames=CSV_FIELDS)
                writer.writeheader()
                file.flush()
                os.fsync(file.fileno())
        self._migrate_legacy_queue()

    def _read_rows(self) -> list[dict[str, str]]:
        with self.path.open("r", newline="", encoding="utf-8") as file:
            reader = csv.DictReader(file)
            if tuple(reader.fieldnames or ()) != CSV_FIELDS:
                raise ValueError(f"offline queue CSV has an unexpected header: {self.path}")
            return list(reader)

    def _append(self, event: dict) -> None:
        row = _csv_row(event)
        with self.path.open("a", newline="", encoding="utf-8") as file:
            writer = csv.DictWriter(file, fieldnames=CSV_FIELDS)
            writer.writerow(row)
            file.flush()
            os.fsync(file.fileno())

    def _write_rows(self, rows: list[dict[str, str]]) -> None:
        temporary = self.path.with_name(f".{self.path.name}.{uuid.uuid4().hex}.tmp")
        try:
            with temporary.open("w", newline="", encoding="utf-8") as file:
                writer = csv.DictWriter(file, fieldnames=CSV_FIELDS)
                writer.writeheader()
                writer.writerows(rows)
                file.flush()
                os.fsync(file.fileno())
            os.replace(temporary, self.path)
        finally:
            temporary.unlink(missing_ok=True)

    def _migrate_legacy_queue(self) -> None:
        if not LEGACY_QUEUE_PATH.is_file() or LEGACY_QUEUE_PATH == self.path:
            return
        marker = LEGACY_QUEUE_PATH.with_suffix(".sqlite3.migrated")
        if marker.exists():
            return
        try:
            with sqlite3.connect(LEGACY_QUEUE_PATH, timeout=10) as db:
                rows = db.execute("SELECT payload FROM pending_analyses ORDER BY created_at, event_id").fetchall()
        except sqlite3.Error:
            return
        with self._lock:
            existing = {row["event_id"] for row in self._read_rows()}
            for (encoded,) in rows:
                event = json.loads(encoded)
                if event["event_id"] not in existing:
                    self._append(event)
                    existing.add(event["event_id"])
            LEGACY_QUEUE_PATH.rename(marker)
        print(f"[offline-sync] migrated {len(rows)} legacy record(s) to {self.path.name}")

    def enqueue(self, payload: dict) -> None:
        row = _csv_row(payload)
        with self._lock:
            rows = self._read_rows()
            if sum(1 for existing in rows if existing["sync_status"] == "pending") >= self.max_events:
                raise QueueFullError(f"offline queue is full ({self.max_events} events)")
            if any(existing["event_id"] == payload["event_id"] for existing in rows):
                return
            with self.path.open("a", newline="", encoding="utf-8") as file:
                csv.DictWriter(file, fieldnames=CSV_FIELDS).writerow(row)
                file.flush()
                os.fsync(file.fileno())

    def pending(self, limit: int = BATCH_SIZE) -> list[dict]:
        with self._lock:
            rows = (row for row in self._read_rows() if row["sync_status"] == "pending")
            return [_event_from_row(row) for row in list(rows)[:limit]]

    def acknowledge(self, event_ids: list[str]) -> None:
        if not event_ids:
            return
        acknowledged = set(event_ids)
        with self._lock:
            rows = self._read_rows()
            for row in rows:
                if row["event_id"] in acknowledged:
                    row["sync_status"] = "synced"
            self._write_rows(rows)

    def size(self) -> int:
        with self._lock:
            return sum(1 for row in self._read_rows() if row["sync_status"] == "pending")


def sync_once(queue: OfflineQueue, url: str, token: str) -> int:
    """Send one batch and remove only records the API confirms it stored."""
    events = queue.pending()
    if not events:
        return 0
    body = json.dumps({"events": events}, separators=(",", ":")).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=body,
        headers={
            "Content-Type": "application/json",
            "X-Vision-Token": token,
        },
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=10) as response:
        result = json.loads(response.read().decode("utf-8"))
    if not isinstance(result, dict):
        raise ValueError("offline-sync API returned an invalid response")
    accepted_ids = result.get("accepted", [])
    duplicate_ids = result.get("duplicates", [])
    if not isinstance(accepted_ids, list) or not isinstance(duplicate_ids, list):
        raise ValueError("offline-sync API returned invalid acknowledgements")
    if any(not isinstance(value, str) for value in accepted_ids + duplicate_ids):
        raise ValueError("offline-sync API returned invalid event IDs")
    confirmed = set(accepted_ids) | set(duplicate_ids)
    batch_ids = {event["event_id"] for event in events}
    acknowledged = sorted(confirmed & batch_ids)
    queue.acknowledge(acknowledged)
    if len(acknowledged) < len(events):
        print(f"[offline-sync] API has not confirmed {len(events) - len(acknowledged)} record(s); they remain queued")
    return len(acknowledged)


def run_worker(
    analyze: Callable[[str], dict | None],
    *,
    enabled: bool = os.getenv("OFFLINE_QUEUE_ENABLED", "1") != "0",
    queue: OfflineQueue | None = None,
    cameras: tuple[str, ...] = CAMERAS,
    sync_url: str = SYNC_URL,
    token: str = os.getenv("VISION_SERVICE_TOKEN", ""),
    sample_seconds: float = SAMPLE_SECONDS,
    sync_seconds: float = SYNC_SECONDS,
) -> None:
    """Sample locally and retry delivery forever; network failures leave the queue intact."""
    if not enabled:
        return
    local_queue = queue or OfflineQueue()
    print(
        f"[offline-sync] CSV queue enabled at {local_queue.path}; sample every {sample_seconds:g}s, "
        f"sync every {sync_seconds:g}s; {local_queue.size()} record(s) pending"
    )
    if not sync_url:
        print("[offline-sync] OFFLINE_SYNC_URL is empty; records will queue locally but cannot upload yet")
    elif not token:
        print("[offline-sync] VISION_SERVICE_TOKEN is empty; records will queue locally but cannot upload")
    last_sample = {camera_id: 0.0 for camera_id in cameras}
    last_sync_log = 0.0
    last_model_warning = 0.0
    while True:
        now = time.monotonic()
        if sync_url and token and local_queue.size():
            try:
                sent = sync_once(local_queue, sync_url, token)
                if sent:
                    print(f"[offline-sync] uploaded {sent} queued camera analysis record(s)")
            except (OSError, TimeoutError, ValueError, urllib.error.URLError) as exc:
                if now - last_sync_log >= 60:
                    print(f"[offline-sync] API unavailable; {local_queue.size()} record(s) remain queued: {exc}")
                    last_sync_log = now

        for camera_id in cameras:
            if now - last_sample[camera_id] < sample_seconds or not camera_is_configured(camera_id):
                continue
            try:
                sampled_at = datetime.now(timezone.utc).isoformat()
                analysis = analyze(camera_id)
                if analysis is None:
                    continue
                if REQUIRE_MODEL and not is_model_result(camera_id, analysis):
                    if now - last_model_warning >= 60:
                        print("[offline-sync] CAM-01 sample skipped: trained ONNX model is unavailable; motion-only results are not saved as model detections")
                        last_model_warning = now
                    continue
                local_queue.enqueue({
                    "event_id": str(uuid.uuid4()),
                    "camera_id": camera_id,
                    "event_at": sampled_at,
                    "analysis": analysis,
                })
                last_sample[camera_id] = now
            except QueueFullError as exc:
                print(f"[offline-sync] could not queue {camera_id} analysis: {exc}")
                last_sample[camera_id] = now
            except Exception as exc:
                print(f"[offline-sync] could not queue {camera_id} analysis: {exc}")
        time.sleep(sync_seconds)


def start_worker(analyze: Callable[[str], dict | None]) -> threading.Thread | None:
    if os.getenv("OFFLINE_QUEUE_ENABLED", "1") == "0":
        return None
    worker = threading.Thread(target=run_worker, args=(analyze,), daemon=True, name="offline-analysis-sync")
    worker.start()
    return worker
