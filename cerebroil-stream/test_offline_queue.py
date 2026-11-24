from __future__ import annotations

import json
import os
import tempfile
import unittest
import urllib.error
import csv
from pathlib import Path
from unittest.mock import patch

import offline_queue


class FakeResponse:
    def __init__(self, value: dict) -> None:
        self.value = value

    def __enter__(self) -> "FakeResponse":
        return self

    def __exit__(self, *_args) -> None:
        return None

    def read(self) -> bytes:
        return json.dumps(self.value).encode("utf-8")


class OfflineQueueTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.path = Path(self.temp.name) / "analysis_queue.csv"
        self.queue = offline_queue.OfflineQueue(self.path, max_events=2)

    def tearDown(self) -> None:
        self.temp.cleanup()

    def event(self, event_id: str) -> dict:
        return {
            "event_id": event_id,
            "camera_id": "CAM-01",
            "event_at": "2026-11-07T06:00:00+00:00",
            "analysis": {"behaviour": {"movement_index": 0.1}},
        }

    def test_pending_records_survive_queue_reopen(self) -> None:
        self.queue.enqueue(self.event("event-1"))
        reopened = offline_queue.OfflineQueue(self.path, max_events=2)
        self.assertEqual(reopened.pending(), [self.event("event-1")])

    def test_analysis_is_saved_in_readable_csv_columns(self) -> None:
        event = self.event("event-1")
        event["analysis"] = {
            "detector": {"source": "model", "model": "broilers.onnx"},
            "behaviour": {"movement_label": "Active"},
            "detection_count": 1,
            "detections": [{"box_x": 10, "behavior": "ACTIVE"}],
            "weight": {"median_g": 420},
            "clusters": [],
        }
        self.queue.enqueue(event)
        with self.path.open("r", newline="", encoding="utf-8") as file:
            row = next(csv.DictReader(file))
        self.assertEqual(row["camera_id"], "CAM-01")
        self.assertEqual(json.loads(row["detector_json"])["model"], "broilers.onnx")
        self.assertEqual(json.loads(row["behavior_json"])["movement_label"], "Active")
        self.assertEqual(json.loads(row["detections_json"])[0]["box_x"], 10)
        self.assertEqual(json.loads(row["weight_json"])["median_g"], 420)

    def test_full_queue_preserves_existing_events(self) -> None:
        self.queue.enqueue(self.event("event-1"))
        self.queue.enqueue(self.event("event-2"))
        with self.assertRaises(offline_queue.QueueFullError):
            self.queue.enqueue(self.event("event-3"))
        self.assertEqual(self.queue.size(), 2)

    def test_sync_removes_only_records_confirmed_by_api(self) -> None:
        self.queue.enqueue(self.event("event-1"))
        self.queue.enqueue(self.event("event-2"))
        with patch.object(
            offline_queue.urllib.request,
            "urlopen",
            return_value=FakeResponse({"accepted": ["event-1"], "failed": [{"event_id": "event-2"}]}),
        ) as send:
            self.assertEqual(offline_queue.sync_once(self.queue, "http://api/visual/offline-sync", "token"), 1)
        request = send.call_args.args[0]
        self.assertEqual(request.headers["X-vision-token"], "token")
        self.assertEqual(self.queue.pending(), [self.event("event-2")])
        self.assertEqual(self.queue.size(), 1)
        with self.path.open("r", newline="", encoding="utf-8") as file:
            rows = {row["event_id"]: row for row in csv.DictReader(file)}
        self.assertEqual(rows["event-1"]["sync_status"], "synced")
        self.assertEqual(rows["event-2"]["sync_status"], "pending")

    def test_replayed_events_are_removed_when_api_reports_duplicates(self) -> None:
        self.queue.enqueue(self.event("event-1"))
        with patch.object(
            offline_queue.urllib.request,
            "urlopen",
            return_value=FakeResponse({"accepted": [], "duplicates": ["event-1"]}),
        ):
            self.assertEqual(offline_queue.sync_once(self.queue, "http://api/visual/offline-sync", "token"), 1)
        self.assertEqual(self.queue.size(), 0)
        with self.path.open("r", newline="", encoding="utf-8") as file:
            row = next(csv.DictReader(file))
        self.assertEqual(row["sync_status"], "synced")

    def test_connection_failure_leaves_events_queued(self) -> None:
        self.queue.enqueue(self.event("event-1"))
        with patch.object(
            offline_queue.urllib.request,
            "urlopen",
            side_effect=urllib.error.URLError("offline"),
        ):
            with self.assertRaises(urllib.error.URLError):
                offline_queue.sync_once(self.queue, "http://api/visual/offline-sync", "token")
        self.assertEqual(self.queue.size(), 1)

    def test_simulated_kinect_is_never_queued_as_a_real_weight(self) -> None:
        with patch.dict(os.environ, {"KINECT_SOURCE": "simulated"}):
            self.assertFalse(offline_queue.camera_is_configured("KINECT-01"))
        with patch.dict(os.environ, {"KINECT_SOURCE": "0"}):
            self.assertTrue(offline_queue.camera_is_configured("KINECT-01"))

    def test_model_only_mode_does_not_save_motion_fallback_as_model_result(self) -> None:
        self.assertFalse(offline_queue.is_model_result("CAM-01", {"detector": {"source": "motion"}}))
        self.assertTrue(offline_queue.is_model_result("CAM-01", {"detector": {"source": "model"}}))


if __name__ == "__main__":
    unittest.main()
