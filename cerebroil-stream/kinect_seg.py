"""
kinect_seg.py: finds and outlines the chickens on the Kinect's colour picture.

It runs on the computer the Kinect is plugged into, next to kinect-bridge. It asks the bridge for
the colour picture (the same one the Picture view shows), runs the trained segmentation model on it,
and keeps the newest answer: how many chickens, and the outline of each.

    python kinect_seg.py            (local-only default; the Windows runner sets the Docker host bind)

The API asks it (GET /visual/kinect-chickens, which needs a sign-in) and the Live Camera page gets
the answer from the API. The service requires KINECT_SEG_TOKEN even when bound for Docker access.

It only works while somebody is watching. Every GET /latest keeps it working for another 15 seconds;
after that it lets go of the bridge, so the sensor and the processor are left alone.

The model is models/kinect_chicken_seg.pt (not in the repository), a YOLO11n-seg model trained on
colour pictures with one class, "chicken". Change the place with KINECT_SEG_MODEL.

Weights: each bird gets a "weightG" from kinect_weight.py. A configured 17-feature
RGB-D model uses a synchronized color mask, Kinect depth frame and depth-to-color map;
the legacy two-feature RGB model remains supported. The estimate is experimental
until checked against scale measurements.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import socket
import struct
import threading
import time
from pathlib import Path
from typing import Any

import cv2
import numpy as np
from dotenv import load_dotenv
from flask import Flask, jsonify, request

import kinect_weight

load_dotenv(Path(__file__).parent / ".env")

MODEL_PATH = Path(os.getenv("KINECT_SEG_MODEL", str(Path(__file__).parent / "models" / "kinect_chicken_seg.pt")))
BRIDGE_HOST = os.getenv("KINECT_BRIDGE_HOST", "127.0.0.1")
BRIDGE_PORT = int(os.getenv("KINECT_BRIDGE_PORT", "8181"))
BRIDGE_KEY = os.getenv("KINECT_BRIDGE_KEY", "")          # same value as the bridge's, if it has one
CONFIDENCE = float(os.getenv("KINECT_SEG_CONFIDENCE", "0.25"))
IMGSZ = int(os.getenv("KINECT_SEG_IMGSZ", "896"))        # the size the model was trained at
WEIGHT_INTRINSICS_PATH = Path(os.getenv(
    "KINECT_WEIGHT_INTRINSICS",
    str(Path(__file__).parent / "models" / "intrinsics_depth_kinect_v2_reference.json"),
))
WEIGHT_FLOOR_HEIGHT_MM = float(os.getenv("KINECT_WEIGHT_FLOOR_HEIGHT_MM", "1500"))
WEIGHT_CALIBRATION_FRAMES = max(1, int(os.getenv("KINECT_WEIGHT_CALIBRATION_FRAMES", "25")))
KEEP_ALIVE_S = 15.0                                      # works this long after the last request
MAX_POINTS = 60                                          # an outline is simplified to about this many points

app = Flask(__name__)
_lock = threading.Lock()
_wanted_until = 0.0
_result: dict[str, Any] = {"ok": False, "status": "starting"}


# ── A small WebSocket client (the standard library has none) ──────────────────────────────────────
class Bridge:
    def __init__(self, want: str = "color") -> None:
        path = "/"
        if BRIDGE_KEY:
            expiry = str(int(time.time()) + 120)
            mac = hmac.new(BRIDGE_KEY.encode(), expiry.encode(), hashlib.sha256).hexdigest()
            path = f"/?t={expiry}.{mac}"
        self.sock = socket.create_connection((BRIDGE_HOST, BRIDGE_PORT), timeout=5)
        key = base64.b64encode(os.urandom(16)).decode()
        self.sock.sendall(
            (
                f"GET {path} HTTP/1.1\r\nHost: {BRIDGE_HOST}:{BRIDGE_PORT}\r\nUpgrade: websocket\r\n"
                f"Connection: Upgrade\r\nSec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\n\r\n"
            ).encode()
        )
        head = b""
        while b"\r\n\r\n" not in head:
            chunk = self.sock.recv(1)
            if not chunk:
                raise ConnectionError("the bridge closed the connection")
            head += chunk
        if b" 101 " not in head.split(b"\r\n")[0]:
            raise ConnectionError(head.split(b"\r\n")[0].decode(errors="replace"))
        self.send_text('{"want":"%s"}' % want)

    def send_text(self, text: str) -> None:
        data = text.encode()
        mask = os.urandom(4)
        self.sock.sendall(bytes([0x81, 0x80 | len(data)]) + mask + bytes(b ^ mask[i % 4] for i, b in enumerate(data)))

    def _exact(self, n: int) -> bytes:
        buf = b""
        while len(buf) < n:
            chunk = self.sock.recv(n - len(buf))
            if not chunk:
                raise ConnectionError("the bridge closed the connection")
            buf += chunk
        return buf

    def read(self) -> tuple[int, bytes]:
        b0, b1 = self._exact(2)
        n = b1 & 0x7F
        if n == 126:
            n = struct.unpack(">H", self._exact(2))[0]
        elif n == 127:
            n = struct.unpack(">Q", self._exact(8))[0]
        return b0 & 0x0F, self._exact(n)

    def newest_picture(self, wait_s: float) -> bytes | None:
        """The newest JPEG waiting on the connection (older ones are dropped), or None if none came in time."""
        picture = None
        self.sock.settimeout(wait_s)
        try:
            while True:
                op, data = self.read()
                if op == 2 and data[:2] == b"\xff\xd8":
                    picture = data
                    self.sock.settimeout(0.02)       # anything else already waiting is newer: take it too
                elif op == 8:
                    raise ConnectionError("the bridge closed the connection")
        except (socket.timeout, TimeoutError):
            pass
        finally:
            self.sock.settimeout(5)
        return picture

    def newest_depth(self, wait_s: float) -> np.ndarray | None:
        """The newest depth picture waiting on a connection made with want="depth", in millimetres (0 = no reading)."""
        frame = None
        self.sock.settimeout(wait_s)
        try:
            while True:
                op, data = self.read()
                if op == 2 and data[:2] != b"\xff\xd8" and len(data) >= 8:
                    w, h = struct.unpack("<HH", data[:4])
                    if len(data) >= 8 + w * h * 2:
                        frame = np.frombuffer(data, dtype="<u2", count=w * h, offset=8).reshape(h, w).astype(np.float32)
                        self.sock.settimeout(0.02)
                elif op == 8:
                    raise ConnectionError("the bridge closed the connection")
        except (socket.timeout, TimeoutError):
            pass
        finally:
            self.sock.settimeout(5)
        return frame

    def newest_rgbd(self, wait_s: float) -> tuple[np.ndarray, np.ndarray, bytes] | None:
        """Read the paired RGB JPEG, full-resolution depth frame and depth-to-color map."""
        frame = None
        self.sock.settimeout(wait_s)
        try:
            while True:
                op, data = self.read()
                if op == 2:
                    if len(data) >= 4:
                        width, height = struct.unpack_from("<HH", data)
                        if (width, height) != (kinect_weight.DEPTH_W, kinect_weight.DEPTH_H):
                            self.sock.settimeout(0.02)
                            continue
                    frame = self.decode_rgbd(data)
                    self.sock.settimeout(0.02)
                elif op == 8:
                    raise ConnectionError("the bridge closed the connection")
        except (socket.timeout, TimeoutError):
            pass
        finally:
            self.sock.settimeout(5)
        return frame

    @staticmethod
    def decode_rgbd(data: bytes) -> tuple[np.ndarray, np.ndarray, bytes]:
        """Decode the bridge's length-prefixed RGB-D binary message."""
        if len(data) < 12:
            raise ValueError("The bridge sent a truncated RGB-D frame header.")
        width, height, _, jpeg_length = struct.unpack_from("<HHII", data)
        pixels = width * height
        depth_start = 12
        map_start = depth_start + pixels * 2
        jpeg_start = map_start + pixels * 4
        if width != kinect_weight.DEPTH_W or height != kinect_weight.DEPTH_H:
            raise ValueError(f"Unexpected RGB-D depth dimensions: {width}x{height}.")
        if len(data) != jpeg_start + jpeg_length:
            raise ValueError("The bridge sent an incomplete RGB-D frame.")
        depth = np.frombuffer(data, dtype="<u2", count=pixels, offset=depth_start)
        depth = depth.reshape(height, width).astype(np.float32)
        depth_to_color = np.frombuffer(data, dtype="<u2", count=pixels * 2, offset=map_start)
        depth_to_color = depth_to_color.reshape(height, width, 2).copy()
        return depth, depth_to_color, data[jpeg_start:]

    def close(self) -> None:
        try:
            self.sock.close()
        except OSError:
            pass


# ── The model ─────────────────────────────────────────────────────────────────────────────────────
_model = None


def load_model():
    global _model
    if _model is None:
        if not MODEL_PATH.exists():
            raise FileNotFoundError(f"The segmentation model is not at {MODEL_PATH}")
        from ultralytics import YOLO

        _model = YOLO(str(MODEL_PATH))
    return _model


_weights = kinect_weight.WeightModel()
_weight_intrinsics: dict[str, float] | None = None
_weight_intrinsics_error: str | None = None
if _weights.available and _weights.rgbd_mode:
    try:
        _weight_intrinsics = kinect_weight.load_intrinsics(WEIGHT_INTRINSICS_PATH)
    except (OSError, ValueError, TypeError, KeyError) as err:
        _weight_intrinsics_error = str(err)[:200]


def add_weights(
    birds: list[dict[str, Any]],
    image_w: int,
    image_h: int,
    depth: np.ndarray | None,
    depth_to_color: np.ndarray | None = None,
    depth_scale: float | None = None,
    color_masks: list[np.ndarray] | None = None,
) -> dict[str, Any]:
    """Puts "weightG" on every bird it can (the rest stay null) and returns the "weight" summary and its status."""
    for bird in birds:
        bird["weightG"] = None
    if not _weights.available:
        return {"weightStatus": "model_not_installed", "weightError": _weights.error, "weight": None}

    measured: list[tuple[dict[str, Any], dict[str, float]]] = []
    if _weights.rgbd_mode:
        if _weight_intrinsics is None:
            return {
                "weightStatus": "intrinsics_not_configured",
                "weightError": _weight_intrinsics_error,
                "weight": None,
            }
        if depth is None or depth_to_color is None:
            return {"weightStatus": "waiting_for_rgbd", "weight": None}
        if depth_scale is None:
            return {"weightStatus": "calibrating_depth", "weight": None}
        if color_masks is None or len(color_masks) != len(birds):
            raise ValueError("RGB-D inference requires one original segmentation mask per bird.")

        depth_mm = kinect_weight.clean_depth(depth * depth_scale)
        height_map = kinect_weight.background_subtract(depth_mm, WEIGHT_FLOOR_HEIGHT_MM)
        for bird, color_mask in zip(birds, color_masks):
            mask = kinect_weight.register_color_mask_to_depth(
                color_mask, depth_to_color, (image_h, image_w)
            )
            try:
                measurements = kinect_weight.compute_rgbd_features(
                    mask, depth_mm, height_map, _weight_intrinsics
                )
            except ImportError as err:
                return {
                    "weightStatus": "dependency_not_installed",
                    "weightError": str(err)[:200],
                    "weight": None,
                }
            if measurements is not None:
                measured.append((bird, measurements))
    else:
        depth_h, depth_w = depth.shape if depth is not None else (kinect_weight.DEPTH_H, kinect_weight.DEPTH_W)
        for bird in birds:
            mask = kinect_weight.mask_from_polygon(bird["polygon"], image_w, image_h, depth_w, depth_h)
            measurements = kinect_weight.measure_rgb_mask(mask)
            if measurements is not None:
                measured.append((bird, measurements))

    grams = _weights.predict([m for _, m in measured])
    for (bird, _), g in zip(measured, grams):
        bird["weightG"] = int(round(g / 10.0) * 10)
    summary = kinect_weight.summarize(grams)
    error_percent = _weights.typical_error_percent
    if summary and error_percent is not None:
        summary["errorPercent"] = round(error_percent)
    return {"weightStatus": "ok" if summary else "no_birds", "weight": summary}


def find_chickens(
    jpeg: bytes,
    depth: np.ndarray | None = None,
    depth_to_color: np.ndarray | None = None,
    depth_scale: float | None = None,
) -> dict[str, Any]:
    image = cv2.imdecode(np.frombuffer(jpeg, np.uint8), cv2.IMREAD_COLOR)
    if image is None:
        raise ValueError("the picture could not be read")
    h, w = image.shape[:2]
    started = time.time()
    r = load_model().predict(
        image, imgsz=IMGSZ, conf=CONFIDENCE, retina_masks=True, verbose=False
    )[0]
    birds: list[dict[str, Any]] = []
    color_masks: list[np.ndarray] = []
    if r.masks is not None and r.boxes is not None:
        source_masks = r.masks.data.cpu().numpy()
        if len(source_masks) != len(r.boxes):
            raise ValueError("The segmentation model returned different mask and box counts.")
        for index, (poly, box, conf) in enumerate(zip(
            r.masks.xyn, r.boxes.xyxyn.cpu().numpy(), r.boxes.conf.cpu().numpy()
        )):
            pts = np.asarray(poly, dtype=np.float32)
            if len(pts) < 3:
                continue
            color_mask = source_masks[index].astype(np.uint8)
            if color_mask.shape != (h, w):
                color_mask = cv2.resize(color_mask, (w, h), interpolation=cv2.INTER_NEAREST)
            if len(pts) > MAX_POINTS:
                # Simplify, a little more each round, until it is short enough.
                eps = 0.001
                while len(pts) > MAX_POINTS and eps < 0.05:
                    pts = cv2.approxPolyDP(np.asarray(poly, dtype=np.float32).reshape(-1, 1, 2), eps, True).reshape(-1, 2)
                    eps *= 1.6
            bird = {
                "confidence": round(float(conf), 3),
                "box": [round(float(v), 4) for v in box],
                "polygon": [[round(float(x), 4), round(float(y), 4)] for x, y in pts],
            }
            birds.append(bird)
            color_masks.append(color_mask)
    weights = add_weights(birds, w, h, depth, depth_to_color, depth_scale, color_masks)
    return {
        "ok": True,
        "at": time.time(),
        "width": w,
        "height": h,
        "count": len(birds),
        "ms": int((time.time() - started) * 1000),
        "birds": birds,
        **weights,
    }


# ── The worker: follows the bridge while someone is watching ──────────────────────────────────────
def worker() -> None:
    global _result
    bridge: Bridge | None = None
    depth_bridge: Bridge | None = None
    rgbd_bridge: Bridge | None = None
    depth_scale: float | None = None
    calibration_depths: list[float] = []
    while True:
        if time.time() > _wanted_until:
            for b in (bridge, depth_bridge, rgbd_bridge):
                if b:
                    b.close()
            bridge = depth_bridge = rgbd_bridge = None
            depth_scale = None
            calibration_depths = []
            time.sleep(0.3)
            continue
        try:
            depth: np.ndarray | None = None
            depth_to_color: np.ndarray | None = None
            if _weights.rgbd_mode:
                if rgbd_bridge is None:
                    rgbd_bridge = Bridge("rgbd")
                rgbd_frame = rgbd_bridge.newest_rgbd(3.0)
                if rgbd_frame is None:
                    with _lock:
                        _result = {"ok": False, "status": "waiting_for_rgbd", "message": "The Kinect is not sending a paired RGB-D frame."}
                    continue
                depth, depth_to_color, jpeg = rgbd_frame
                if depth_scale is None:
                    valid_depth = depth[depth > 0]
                    if valid_depth.size:
                        calibration_depths.append(float(np.median(valid_depth)))
                    if len(calibration_depths) >= WEIGHT_CALIBRATION_FRAMES:
                        median_floor_depth = float(np.median(calibration_depths))
                        if median_floor_depth <= 0:
                            raise RuntimeError("Could not estimate a positive Kinect floor depth.")
                        depth_scale = WEIGHT_FLOOR_HEIGHT_MM / median_floor_depth
            else:
                if bridge is None:
                    bridge = Bridge()
                if depth_bridge is None and _weights.available:
                    depth_bridge = Bridge("depth")
                jpeg = bridge.newest_picture(3.0)
                if jpeg is None:
                    with _lock:
                        _result = {"ok": False, "status": "waiting_for_picture", "message": "The Kinect is not sending a picture."}
                    continue
                depth = depth_bridge.newest_depth(0.3) if depth_bridge else None
            result = find_chickens(jpeg, depth, depth_to_color, depth_scale)
            with _lock:
                _result = result
        except FileNotFoundError as err:
            with _lock:
                _result = {"ok": False, "status": "model_not_installed", "message": str(err)}
            time.sleep(3)
        except (OSError, ConnectionError) as err:
            for b in (bridge, depth_bridge, rgbd_bridge):
                if b:
                    b.close()
            bridge = depth_bridge = rgbd_bridge = None
            depth_scale = None
            calibration_depths = []
            with _lock:
                _result = {"ok": False, "status": "bridge_unreachable", "message": f"The Kinect bridge is not answering ({err})."}
            time.sleep(2)
        except Exception as err:  # noqa: BLE001 - keep going, and say what happened
            with _lock:
                _result = {"ok": False, "status": "error", "message": str(err)[:200]}
            time.sleep(2)


# ── HTTP ──────────────────────────────────────────────────────────────────────────────────────────
@app.before_request
def require_service_token():
    expected = os.getenv("KINECT_SEG_TOKEN", "")
    supplied = request.headers.get("X-Kinect-Token", "")
    if not expected:
        return jsonify({"error": "kinect_token_not_configured"}), 503
    if not hmac.compare_digest(supplied, expected):
        return jsonify({"error": "unauthorized"}), 401
    return None


@app.get("/latest")
def latest():
    global _wanted_until
    _wanted_until = time.time() + KEEP_ALIVE_S
    with _lock:
        out = dict(_result)
    return jsonify(out)


@app.get("/health")
def health():
    return jsonify({"status": "ok", "model_installed": MODEL_PATH.exists(), "working": time.time() < _wanted_until})


if __name__ == "__main__":
    threading.Thread(target=worker, daemon=True).start()
    host = os.getenv("KINECT_SEG_HOST", "127.0.0.1")
    port = int(os.getenv("KINECT_SEG_PORT", "8182"))
    print(f"kinect_seg: model {MODEL_PATH.name}, listening on {host}:{port}")
    app.run(host=host, port=port, threaded=True, debug=False)
