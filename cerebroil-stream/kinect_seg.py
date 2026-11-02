"""
kinect_seg.py: finds and outlines the chickens on the Kinect's colour picture.

It runs on the computer the Kinect is plugged into, next to kinect-bridge. It asks the bridge for
the colour picture (the same one the Picture view shows), runs the trained segmentation model on it,
and keeps the newest answer: how many chickens, and the outline of each.

    python kinect_seg.py            (listens on 127.0.0.1:8182 only)

Nothing reaches it from outside: the API asks it (GET /visual/kinect-chickens, which needs a sign-in)
and the Live Camera page gets the answer from the API.

It only works while somebody is watching. Every GET /latest keeps it working for another 15 seconds;
after that it lets go of the bridge, so the sensor and the processor are left alone.

The model is models/kinect_chicken_seg.pt (not in the repository), a YOLO11n-seg model trained on
colour pictures with one class, "chicken". Change the place with KINECT_SEG_MODEL.

Weights: each bird also gets a "weightG", an estimate from the size of its outline on the depth picture
(kinect_weight.py, model models/weight_model_size_v1.json). It asks the bridge for the depth picture too. One bird is
typically off by about 18 %; the "weight" summary (the flock's average) is much closer. Without the weight model or
the depth picture every "weightG" is null and the outlines work as before.
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
from flask import Flask, jsonify

import kinect_weight

load_dotenv(Path(__file__).parent / ".env")

MODEL_PATH = Path(os.getenv("KINECT_SEG_MODEL", str(Path(__file__).parent / "models" / "kinect_chicken_seg.pt")))
BRIDGE_HOST = os.getenv("KINECT_BRIDGE_HOST", "127.0.0.1")
BRIDGE_PORT = int(os.getenv("KINECT_BRIDGE_PORT", "8181"))
BRIDGE_KEY = os.getenv("KINECT_BRIDGE_KEY", "")          # same value as the bridge's, if it has one
CONFIDENCE = float(os.getenv("KINECT_SEG_CONFIDENCE", "0.25"))
IMGSZ = int(os.getenv("KINECT_SEG_IMGSZ", "896"))        # the size the model was trained at
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


def add_weights(birds: list[dict[str, Any]], image_w: int, image_h: int, depth: np.ndarray | None) -> dict[str, Any]:
    """Puts "weightG" on every bird it can (the rest stay null) and returns the "weight" summary and its status."""
    for bird in birds:
        bird["weightG"] = None
    if not _weights.available:
        return {"weightStatus": "model_not_installed", "weight": None}
    if depth is None:
        return {"weightStatus": "no_depth", "weight": None}
    measured: list[tuple[dict[str, Any], dict[str, float]]] = []
    for bird in birds:
        mask = kinect_weight.mask_from_polygon(bird["polygon"], image_w, image_h, depth.shape[1], depth.shape[0])
        m = kinect_weight.measure(depth, mask)
        if m is not None:
            measured.append((bird, m))
    grams = _weights.predict([m for _, m in measured])
    for (bird, _), g in zip(measured, grams):
        bird["weightG"] = int(round(g / 10.0) * 10)
    summary = kinect_weight.summarize(grams)
    if summary:
        summary["errorPercent"] = round(_weights.typical_error_percent)
    return {"weightStatus": "ok" if summary else "no_birds", "weight": summary}


def find_chickens(jpeg: bytes, depth: np.ndarray | None = None) -> dict[str, Any]:
    image = cv2.imdecode(np.frombuffer(jpeg, np.uint8), cv2.IMREAD_COLOR)
    if image is None:
        raise ValueError("the picture could not be read")
    h, w = image.shape[:2]
    started = time.time()
    r = load_model().predict(image, imgsz=IMGSZ, conf=CONFIDENCE, verbose=False)[0]
    birds: list[dict[str, Any]] = []
    if r.masks is not None and r.boxes is not None:
        for poly, box, conf in zip(r.masks.xyn, r.boxes.xyxyn.cpu().numpy(), r.boxes.conf.cpu().numpy()):
            pts = np.asarray(poly, dtype=np.float32)
            if len(pts) < 3:
                continue
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
    weights = add_weights(birds, w, h, depth)
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
    while True:
        if time.time() > _wanted_until:
            for b in (bridge, depth_bridge):
                if b:
                    b.close()
            bridge = depth_bridge = None
            time.sleep(0.3)
            continue
        try:
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
            result = find_chickens(jpeg, depth)
            with _lock:
                _result = result
        except FileNotFoundError as err:
            with _lock:
                _result = {"ok": False, "status": "model_not_installed", "message": str(err)}
            time.sleep(3)
        except (OSError, ConnectionError) as err:
            for b in (bridge, depth_bridge):
                if b:
                    b.close()
            bridge = depth_bridge = None
            with _lock:
                _result = {"ok": False, "status": "bridge_unreachable", "message": f"The Kinect bridge is not answering ({err})."}
            time.sleep(2)
        except Exception as err:  # noqa: BLE001 - keep going, and say what happened
            with _lock:
                _result = {"ok": False, "status": "error", "message": str(err)[:200]}
            time.sleep(2)


# ── HTTP ──────────────────────────────────────────────────────────────────────────────────────────
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
    print(f"kinect_seg: model {MODEL_PATH.name}, listening on 127.0.0.1:8182 (this computer only)")
    app.run(host="127.0.0.1", port=int(os.getenv("KINECT_SEG_PORT", "8182")), threaded=True, debug=False)
