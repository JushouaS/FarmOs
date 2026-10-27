"""
app.py — Cerebroil Dual-Camera Live Stream Server
──────────────────────────────────────────────────
Serves both:
  1. Dahua IR CCTV camera (RTSP overhead surveillance) -> /video_feed/dahua
  2. 3D Kinect depth camera (RGB-D weighing station)   -> /video_feed/kinect

Allows projecting both streams separately or side-by-side over HTTP/MJPEG.
Also provides /submit-sus for SUS questionnaire feedback.
"""
from __future__ import annotations

import csv
import math
import os
import threading
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Generator

import cv2
import numpy as np
from flask import Flask, Response, jsonify, render_template, request

# ── Configuration ─────────────────────────────────────────────────────────────
DAHUA_RTSP_URL = os.getenv(
    "DAHUA_RTSP_URL",
    os.getenv("RTSP_URL", "rtsp://admin:12345qwert@192.168.1.108:554/cam/realmonitor?channel=1&subtype=1"),
)
KINECT_SOURCE = os.getenv("KINECT_SOURCE", "simulated")  # "0", "1", rtsp url, or "simulated"

JPEG_QUALITY   = 75       # 70-80% is optimal for LAN MJPEG
FRAME_TIMEOUT  = 5.0      # seconds before camera reconnect
RETRY_DELAY    = 3.0      # seconds between reconnect attempts
SUS_CSV        = Path("sus_responses") / "responses.csv"

app = Flask(__name__)

# ── Thread-safe frame buffers ──────────────────────────────────────────────────
_dahua_lock          = threading.Lock()
_latest_dahua_frame: bytes | None = None
_dahua_ok            = False

_kinect_lock         = threading.Lock()
_latest_kinect_frame: bytes | None = None
_kinect_ok           = False


# ── Dahua CCTV IR Camera Loop ─────────────────────────────────────────────────
def dahua_capture_loop() -> None:
    global _latest_dahua_frame, _dahua_ok
    encode_params = [int(cv2.IMWRITE_JPEG_QUALITY), JPEG_QUALITY]

    while True:
        print(f"[dahua] Connecting to {DAHUA_RTSP_URL} …")
        cap = cv2.VideoCapture(DAHUA_RTSP_URL, cv2.CAP_FFMPEG)
        cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)

        if not cap.isOpened():
            print(f"[dahua] Failed to open stream. Retrying in {RETRY_DELAY}s …")
            _dahua_ok = False
            time.sleep(RETRY_DELAY)
            continue

        print("[dahua] Connected.")
        _dahua_ok = True
        last_frame_time = time.monotonic()

        while True:
            ret, frame = cap.read()
            if not ret or frame is None:
                elapsed = time.monotonic() - last_frame_time
                if elapsed > FRAME_TIMEOUT:
                    print(f"[dahua] No frame for {elapsed:.1f}s — reconnecting …")
                    break
                time.sleep(0.01)
                continue

            last_frame_time = time.monotonic()
            _, buffer = cv2.imencode(".jpg", frame, encode_params)
            with _dahua_lock:
                _latest_dahua_frame = buffer.tobytes()

        cap.release()
        _dahua_ok = False
        print(f"[dahua] Disconnected. Retrying in {RETRY_DELAY}s …")
        time.sleep(RETRY_DELAY)


# ── 3D Kinect Depth Camera Loop ───────────────────────────────────────────────
def _generate_synthetic_kinect_depth_frame(frame_idx: int) -> np.ndarray:
    """
    Generates a realistic 3D depth-map frame (Turbo colormap) of the weighing station.
    Used when Kinect is in simulated mode or physical USB device is initializing.
    """
    w, h = 640, 360
    # Background floor depth (~1400mm)
    depth = np.full((h, w), 140, dtype=np.uint8)

    # Weighing scale platform contour (centered, ~1100mm)
    cv2.rectangle(depth, (160, 90), (480, 270), 110, -1)
    cv2.rectangle(depth, (180, 110), (460, 250), 95, -1)

    # Simulated broilers on weighing station with breathing / movement
    t = frame_idx * 0.1
    birds = [
        (230 + int(math.sin(t) * 4), 160 + int(math.cos(t * 0.8) * 3), 40, 30),
        (340 + int(math.cos(t * 1.2) * 5), 180 + int(math.sin(t) * 4), 45, 32),
        (400 + int(math.sin(t * 0.9) * 3), 140 + int(math.cos(t * 1.1) * 3), 38, 28),
    ]

    for bx, by, rx, ry in birds:
        # Ellipse representing broiler back depth (~750-850mm)
        cv2.ellipse(depth, (bx, by), (rx, ry), 0, 0, 360, 50, -1)
        cv2.ellipse(depth, (bx, by), (int(rx * 0.6), int(ry * 0.6)), 0, 0, 360, 25, -1)

    # Add subtle Gaussian noise to mimic real infrared structured light sensor noise
    noise = np.random.normal(0, 2, (h, w)).astype(np.int16)
    noisy_depth = np.clip(depth.astype(np.int16) + noise, 0, 255).astype(np.uint8)

    # Apply pseudo-color depth colormap (Turbo or Jet)
    color_depth = cv2.applyColorMap(noisy_depth, cv2.COLORMAP_TURBO)

    # Depth overlay text & scale legend
    cv2.putText(color_depth, "KINECT 3D DEPTH MAP [mm]", (18, 28),
                cv2.FONT_HERSHEY_SIMPLEX, 0.55, (255, 255, 255), 1, cv2.LINE_AA)
    timestamp_str = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")
    cv2.putText(color_depth, timestamp_str, (18, 50),
                cv2.FONT_HERSHEY_SIMPLEX, 0.42, (200, 200, 200), 1, cv2.LINE_AA)
    cv2.putText(color_depth, "STATION 1 - WEIGHING ZONE", (w - 240, 28),
                cv2.FONT_HERSHEY_SIMPLEX, 0.45, (0, 255, 255), 1, cv2.LINE_AA)

    # Draw colorbar scale legend on right edge
    for i in range(h - 80):
        color_val = int((i / (h - 80)) * 255)
        color = cv2.applyColorMap(np.array([[color_val]], dtype=np.uint8), cv2.COLORMAP_TURBO)[0, 0]
        cv2.line(color_depth, (w - 25, 40 + i), (w - 15, 40 + i), color.tolist(), 1)
    cv2.putText(color_depth, "600mm", (w - 65, 45), cv2.FONT_HERSHEY_SIMPLEX, 0.32, (255, 255, 255), 1)
    cv2.putText(color_depth, "1500mm", (w - 70, h - 45), cv2.FONT_HERSHEY_SIMPLEX, 0.32, (255, 255, 255), 1)

    return color_depth


def kinect_capture_loop() -> None:
    global _latest_kinect_frame, _kinect_ok
    encode_params = [int(cv2.IMWRITE_JPEG_QUALITY), JPEG_QUALITY]

    # Check if real video source or simulated
    is_device = False
    source: int | str = KINECT_SOURCE
    if KINECT_SOURCE.isdigit():
        source = int(KINECT_SOURCE)
        is_device = True
    elif KINECT_SOURCE.startswith(("rtsp://", "http://", "/dev/video")):
        is_device = True

    frame_count = 0
    while True:
        if is_device:
            print(f"[kinect] Opening video source {source} …")
            cap = cv2.VideoCapture(source)
            if cap.isOpened():
                print("[kinect] Connected to device.")
                _kinect_ok = True
                while True:
                    ret, frame = cap.read()
                    if not ret or frame is None:
                        print("[kinect] Frame read failed — reconnecting …")
                        break
                    _, buffer = cv2.imencode(".jpg", frame, encode_params)
                    with _kinect_lock:
                        _latest_kinect_frame = buffer.tobytes()
                    time.sleep(1 / 30)
                cap.release()
                _kinect_ok = False
            else:
                print(f"[kinect] Cannot open {source}, falling back to real-time depth synthesis.")

        # Real-time depth generator mode
        _kinect_ok = True
        synth_frame = _generate_synthetic_kinect_depth_frame(frame_count)
        frame_count += 1
        _, buffer = cv2.imencode(".jpg", synth_frame, encode_params)
        with _kinect_lock:
            _latest_kinect_frame = buffer.tobytes()
        time.sleep(1 / 25)  # 25 fps


# ── MJPEG Stream Generators ───────────────────────────────────────────────────
PLACEHOLDER = (
    b"\xff\xd8\xff\xe0\x00\x10JFIF\x00\x01\x01\x00\x00\x01\x00\x01\x00\x00"
    b"\xff\xdb\x00C\x00\x08\x06\x06\x07\x06\x05\x08\x07\x07\x07\t\t"
    b"\x08\n\x0c\x14\r\x0c\x0b\x0b\x0c\x19\x12\x13\x0f\x14\x1d\x1a"
    b"\x1f\x1e\x1d\x1a\x1c\x1c $.' \",#\x1c\x1c(7),01444\x1f'9=82<.342\x1e"
    b"\xff\xc0\x00\x0b\x08\x00\x01\x00\x01\x01\x01\x11\x00\xff\xc4\x00\x1f"
    b"\x00\x00\x01\x05\x01\x01\x01\x01\x01\x01\x00\x00\x00\x00\x00\x00\x00"
    b"\x00\x01\x02\x03\x04\x05\x06\x07\x08\t\n\x0b\xff\xc4\x00\xb5\x10\x00"
    b"\x02\x01\x03\x03\x02\x04\x03\x05\x05\x04\x04\x00\x00\x01}\x01\x02"
    b"\x03\x00\x04\x11\x05\x12!1A\x06\x13Qa\x07\"q\x142\x81\x91\xa1\x08"
    b"#B\xb1\xc1\x15R\xd1\xf0$3br\x82\t\n\x16\x17\x18\x19\x1a%&'()*456789"
    b":CDEFGHIJSTUVWXYZcdefghijstuvwxyz\xff\xda\x00\x08\x01\x01\x00\x00?"
    b"\x00\xfb\xd4P\x00\x00\x00\x1f\xff\xd9"
)


def _generate_mjpeg_stream(lock: threading.Lock, frame_accessor: callable) -> Generator[bytes, None, None]:
    while True:
        with lock:
            frame = frame_accessor()
        data = frame if frame is not None else PLACEHOLDER
        yield (
            b"--frame\r\n"
            b"Content-Type: image/jpeg\r\n\r\n"
            + data
            + b"\r\n"
        )
        time.sleep(1 / 25)


# ── HTTP Routes ───────────────────────────────────────────────────────────────
@app.get("/")
def index() -> str:
    return render_template("index.html")


@app.get("/video_feed")
@app.get("/video_feed/dahua")
def video_feed_dahua() -> Response:
    """Overhead Dahua IR CCTV stream."""
    return Response(
        _generate_mjpeg_stream(_dahua_lock, lambda: _latest_dahua_frame),
        mimetype="multipart/x-mixed-replace; boundary=frame",
    )


@app.get("/video_feed/kinect")
def video_feed_kinect() -> Response:
    """3D Kinect depth-to-weight station stream."""
    return Response(
        _generate_mjpeg_stream(_kinect_lock, lambda: _latest_kinect_frame),
        mimetype="multipart/x-mixed-replace; boundary=frame",
    )


@app.get("/status")
def status() -> Response:
    """Status probe for both Dahua and Kinect streams."""
    return jsonify({
        "camera_ok": _dahua_ok or _kinect_ok,
        "dahua_ok": _dahua_ok,
        "kinect_ok": _kinect_ok,
        "dahua_url": DAHUA_RTSP_URL,
        "kinect_source": KINECT_SOURCE,
    })


@app.post("/submit-sus")
def submit_sus() -> Response:
    data = request.get_json(force=True)

    try:
        scores = [int(data[f"q{i}"]) for i in range(1, 11)]
    except (KeyError, ValueError, TypeError):
        return jsonify({"error": "Provide q1–q10 as integers 1–5"}), 400

    if any(s < 1 or s > 5 for s in scores):
        return jsonify({"error": "Each score must be 1–5"}), 400

    adj = []
    for i, s in enumerate(scores):
        adj.append(s - 1 if (i + 1) % 2 == 1 else 5 - s)
    sus_score = round(sum(adj) * 2.5, 1)

    def _sanitize_csv_cell(val: object) -> str:
        s = str(val or "").strip()
        if s and s[0] in ("=", "+", "-", "@", "\t", "\r"):
            return "'" + s
        return s

    SUS_CSV.parent.mkdir(parents=True, exist_ok=True)
    write_header = not SUS_CSV.exists()
    with open(SUS_CSV, "a", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        if write_header:
            writer.writerow(
                ["timestamp", "respondent", "role"]
                + [f"q{i}" for i in range(1, 11)]
                + ["sus_score"]
            )
        writer.writerow(
            [
                datetime.now(timezone.utc).isoformat(),
                _sanitize_csv_cell(data.get("respondent", "anonymous")),
                _sanitize_csv_cell(data.get("role", "")),
            ]
            + scores
            + [sus_score]
        )

    return jsonify({"sus_score": sus_score, "interpretation": _interpret(sus_score)})


def _interpret(score: float) -> str:
    if score >= 85:  return "Excellent"
    if score >= 73:  return "Good"
    if score >= 68:  return "OK"
    if score >= 51:  return "Poor"
    return "Awful"


# ── Entry point ───────────────────────────────────────────────────────────────
if __name__ == "__main__":
    t_dahua = threading.Thread(target=dahua_capture_loop, daemon=True)
    t_dahua.start()

    t_kinect = threading.Thread(target=kinect_capture_loop, daemon=True)
    t_kinect.start()

    app.run(host="0.0.0.0", port=5000, threaded=True, debug=False)
