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
import re
import threading
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Generator

import base64
import cv2
import numpy as np
from dotenv import load_dotenv
from flask import Flask, Response, jsonify, render_template, request

# Load cerebroil-stream/.env (if present) before reading any of the vars below.
load_dotenv()

# ── Configuration ─────────────────────────────────────────────────────────────
# No default: the URL carries the camera's login, so it must come from .env
# (see .env.example). Unset means the Dahua stream stays off.
DAHUA_RTSP_URL = os.getenv("DAHUA_RTSP_URL", os.getenv("RTSP_URL", ""))
KINECT_SOURCE = os.getenv("KINECT_SOURCE", "simulated")  # "0", "1", rtsp url, or "simulated"


def _redact_url(url: str) -> str:
    """Camera URL with its password replaced by ***, for logs and responses."""
    return re.sub(r"(://[^:/@]*:)[^@]*@", r"\1***@", url)

# Shared secret expected from packages/api (X-Vision-Token header). No
# insecure default: an empty value means every protected route below refuses.
VISION_SERVICE_TOKEN = os.getenv("VISION_SERVICE_TOKEN", "")

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

# State for the lightweight frame-diff analysis used by /analyze (see below).
_ANALYZE_LOCK        = threading.Lock()
_dahua_prev_gray: np.ndarray | None = None

# Camera ids as used by the frontend/packages/api (dataset.ts: CAM-01, KINECT-01)
# mapped to this service's internal stream names.
_CAMERA_SOURCES = {
    "CAM-01": "dahua", "dahua": "dahua", "DAHUA": "dahua",
    "KINECT-01": "kinect", "kinect": "kinect", "KINECT": "kinect",
}


# ── Dahua CCTV IR Camera Loop ─────────────────────────────────────────────────
def dahua_capture_loop() -> None:
    global _latest_dahua_frame, _dahua_ok
    encode_params = [int(cv2.IMWRITE_JPEG_QUALITY), JPEG_QUALITY]

    if not DAHUA_RTSP_URL:
        print("[dahua] DAHUA_RTSP_URL is not set in .env; Dahua stream disabled.")
        return

    while True:
        print(f"[dahua] Connecting to {_redact_url(DAHUA_RTSP_URL)} …")
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
            print(f"[kinect] Opening video source {_redact_url(str(source))} …")
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
                print(f"[kinect] Cannot open {_redact_url(str(source))}, falling back to real-time depth synthesis.")

        # Real-time depth generator mode
        _kinect_ok = True
        synth_frame = _generate_synthetic_kinect_depth_frame(frame_count)
        frame_count += 1
        _, buffer = cv2.imencode(".jpg", synth_frame, encode_params)
        with _kinect_lock:
            _latest_kinect_frame = buffer.tobytes()
        time.sleep(1 / 25)  # 25 fps


# ── MJPEG Stream Generators ───────────────────────────────────────────────────
def _make_placeholder_jpeg() -> bytes:
    """Frame streamed while a camera has no signal. Encoded by OpenCV so every
    browser can decode it: an undecodable frame makes the page's <img> fire
    onError, which the dashboard reports as the whole service being down."""
    frame = np.full((360, 640, 3), (23, 15, 2), dtype=np.uint8)  # slate-950 (BGR)
    font = cv2.FONT_HERSHEY_SIMPLEX
    for text, scale, y, color in (
        ("NO CAMERA SIGNAL", 0.9, 170, (241, 245, 241)),
        ("Camera off or unreachable - retrying", 0.55, 205, (184, 163, 148)),
    ):
        (w, _), _ = cv2.getTextSize(text, font, scale, 2)
        cv2.putText(frame, text, ((640 - w) // 2, y), font, scale, color, 2, cv2.LINE_AA)
    _, buffer = cv2.imencode(".jpg", frame, [int(cv2.IMWRITE_JPEG_QUALITY), JPEG_QUALITY])
    return buffer.tobytes()


PLACEHOLDER = _make_placeholder_jpeg()


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
        "dahua_url": _redact_url(DAHUA_RTSP_URL),
        "kinect_source": _redact_url(KINECT_SOURCE),
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



# ── Vision-proxy contract (consumed by packages/api's vision-proxy.ts) ───────
#
# packages/api never lets the browser talk to this service directly: it
# forwards requests here with an X-Vision-Token header and proxies the
# response. The routes below implement the contract packages/api expects
# (/health, /cameras, /stream/<id>, /capture/<id>, /analyze/<id>) — these did
# not previously exist, which made every "Live Camera" / analyze call fail.

def _require_vision_token() -> tuple[Response, int] | None:
    """Returns an (error response, status) pair if the shared-secret header
    is missing/wrong, else None. No insecure default: an unset token refuses
    every protected route rather than silently allowing access."""
    if not VISION_SERVICE_TOKEN:
        return jsonify({"error": "vision_token_not_configured"}), 500
    if request.headers.get("X-Vision-Token", "") != VISION_SERVICE_TOKEN:
        return jsonify({"error": "unauthorized"}), 401
    return None


def _resolve_camera(camera_id: str) -> str | None:
    return _CAMERA_SOURCES.get(camera_id)


def _connected(source: str) -> bool:
    return _dahua_ok if source == "dahua" else _kinect_ok


def _latest_frame_bytes(source: str) -> bytes | None:
    if source == "dahua":
        with _dahua_lock:
            return _latest_dahua_frame
    with _kinect_lock:
        return _latest_kinect_frame


@app.get("/health")
def vision_health() -> Response:
    err = _require_vision_token()
    if err:
        return err
    connected = sum(1 for s in ("dahua", "kinect") if _connected(s))
    return jsonify({
        "status": "ok" if connected > 0 else "degraded",
        "cameras_configured": len(set(_CAMERA_SOURCES.values())),
        "cameras_connected": connected,
    })


@app.get("/cameras")
def vision_cameras() -> Response:
    err = _require_vision_token()
    if err:
        return err
    return jsonify([
        {"camera_id": "CAM-01", "rtsp_url": _redact_url(DAHUA_RTSP_URL), "connected": _dahua_ok},
        {"camera_id": "KINECT-01", "rtsp_url": _redact_url(KINECT_SOURCE), "connected": _kinect_ok},
    ])


@app.get("/stream/<camera_id>")
def vision_stream(camera_id: str) -> Response:
    err = _require_vision_token()
    if err:
        return err
    source = _resolve_camera(camera_id)
    if source is None:
        return jsonify({"error": "unknown_camera"}), 404
    lock = _dahua_lock if source == "dahua" else _kinect_lock
    accessor = (lambda: _latest_dahua_frame) if source == "dahua" else (lambda: _latest_kinect_frame)
    return Response(
        _generate_mjpeg_stream(lock, accessor),
        mimetype="multipart/x-mixed-replace; boundary=frame",
    )


@app.post("/capture/<camera_id>")
def vision_capture(camera_id: str) -> Response:
    err = _require_vision_token()
    if err:
        return err
    source = _resolve_camera(camera_id)
    if source is None:
        return jsonify({"error": "unknown_camera"}), 404
    frame_bytes = _latest_frame_bytes(source)
    if frame_bytes is None:
        return jsonify({"error": "no_frame_available"}), 503
    return jsonify({
        "camera_id": camera_id,
        "connected": _connected(source),
        "image": base64.b64encode(frame_bytes).decode("ascii"),
        "content_type": "image/jpeg",
        "size_bytes": len(frame_bytes),
    })


def _analyze_dahua(frame_bytes: bytes) -> dict:
    """Frame-difference + contour activity analysis on the real captured
    frame. This is a lightweight, honest stand-in for the YOLOv8/ByteTrack
    pipeline described in CEREBROILER.md/cerebroil-backend — it reports real
    motion signal from the camera, not a trained detector's output. Swap this
    for an actual model inference call when one is wired up."""
    global _dahua_prev_gray
    arr = cv2.imdecode(np.frombuffer(frame_bytes, dtype=np.uint8), cv2.IMREAD_COLOR)
    if arr is None:
        return {"detections": [], "movement_index": 0.0, "aggression_events": 0}

    gray = cv2.GaussianBlur(cv2.cvtColor(arr, cv2.COLOR_BGR2GRAY), (5, 5), 0)
    detections: list[dict] = []
    movement_index = 0.0

    with _ANALYZE_LOCK:
        prev = _dahua_prev_gray
        _dahua_prev_gray = gray

    if prev is not None and prev.shape == gray.shape:
        diff = cv2.absdiff(prev, gray)
        movement_index = round(float(np.mean(diff)) / 255.0, 4)
        _, thresh = cv2.threshold(diff, 20, 255, cv2.THRESH_BINARY)
        thresh = cv2.dilate(thresh, None, iterations=2)
        contours, _ = cv2.findContours(thresh, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        for c in contours:
            if cv2.contourArea(c) < 80:  # drop compression/sensor noise
                continue
            x, y, w, h = cv2.boundingRect(c)
            detections.append({
                "box_x": float(x), "box_y": float(y), "box_w": float(w), "box_h": float(h),
                "behavior": "ACTIVE", "estimated_weight_g": None,
                "weight_confidence": None, "flag": None,
            })

    return {"detections": detections[:50], "movement_index": movement_index, "aggression_events": 0}


def _analyze_kinect(frame_bytes: bytes) -> dict | None:
    """ROI mean-intensity mass estimate from the depth colormap frame.
    Calibrated against the synthetic generator's bird-ellipse vs. empty-
    platform depth bands. Treat as an estimate pending a real depth-SDK
    integration, not a calibrated measurement."""
    arr = cv2.imdecode(np.frombuffer(frame_bytes, dtype=np.uint8), cv2.IMREAD_COLOR)
    if arr is None:
        return None
    h, w = arr.shape[:2]
    roi = arr[int(h * 0.25):int(h * 0.75), int(w * 0.25):int(w * 0.75)]
    mean_intensity = float(np.mean(cv2.cvtColor(roi, cv2.COLOR_BGR2GRAY)))
    calculated_mass_g = max(0.0, round(2400.0 - mean_intensity * 9.5, 1))
    return {
        "median_g": calculated_mass_g,
        "std_dev_g": round(calculated_mass_g * 0.06, 1),
        "sample_size": 1,
        "confidence": 0.55,
    }


@app.post("/analyze/<camera_id>")
def vision_analyze(camera_id: str) -> Response:
    err = _require_vision_token()
    if err:
        return err
    source = _resolve_camera(camera_id)
    if source is None:
        return jsonify({"error": "unknown_camera"}), 404
    frame_bytes = _latest_frame_bytes(source)
    if frame_bytes is None:
        return jsonify({"error": "no_frame_available"}), 503

    result = {
        "camera_id": camera_id,
        # This service has no database connection by design — persistence is
        # packages/api's job. It overwrites this field after it actually
        # writes the rows; never report true from here.
        "db_written": False,
        "detections": [],
        "detection_count": 0,
        "behaviour": {
            "movement_index": 0.0, "movement_label": "Unknown", "movement_status": "nominal",
            "huddling_risk": 0.0, "huddling_label": "Low", "huddling_status": "nominal",
            "aggression_events": 0,
        },
        "weight": None,
        "clusters": [],
        "cluster_count": 0,
    }

    if source == "dahua":
        analysis = _analyze_dahua(frame_bytes)
        result["detections"] = analysis["detections"]
        result["detection_count"] = len(analysis["detections"])
        mi = analysis["movement_index"]
        result["behaviour"] = {
            "movement_index": mi,
            "movement_label": "Active" if mi > 0.02 else "Inactive",
            "movement_status": "nominal" if mi > 0.02 else "warning",
            "huddling_risk": round(max(0.0, 1.0 - mi * 10), 4),
            "huddling_label": "Low" if mi > 0.02 else "High",
            "huddling_status": "nominal" if mi > 0.02 else "warning",
            "aggression_events": analysis["aggression_events"],
        }
        if result["detection_count"] >= 6:
            result["clusters"] = [{
                "label": "High density cluster",
                "risk": round(min(1.0, result["detection_count"] / 20), 4),
                "box": "roi",
            }]
            result["cluster_count"] = 1
    else:
        result["weight"] = _analyze_kinect(frame_bytes)

    return jsonify(result)


# ── Entry point ───────────────────────────────────────────────────────────────
if __name__ == "__main__":
    t_dahua = threading.Thread(target=dahua_capture_loop, daemon=True)
    t_dahua.start()

    t_kinect = threading.Thread(target=kinect_capture_loop, daemon=True)
    t_kinect.start()

    app.run(host="0.0.0.0", port=5000, threaded=True, debug=False)
