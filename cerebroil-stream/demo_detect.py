"""
demo_detect.py: runs the trained detector (a YOLO model exported to ONNX) on an
uploaded video, for the "Test video" button on Live Camera.

It samples the clip a few times a second and returns the boxes the model found
in each sampled frame. The browser plays the original video and draws the boxes
over it, so nothing is re-encoded here.

The model file is not part of the repository. Put it at models/detector.onnx or
set DETECTOR_MODEL_PATH. It uses onnxruntime only (no PyTorch), so it also runs
on a Raspberry Pi.
"""
from __future__ import annotations

import ast
import os
import threading
from pathlib import Path
from typing import Any

import cv2
import numpy as np

import behavior

MODEL_PATH = Path(os.getenv("DETECTOR_MODEL_PATH", str(Path(__file__).parent / "models" / "detector.onnx")))
MAX_SECONDS = float(os.getenv("DEMO_MAX_SECONDS", "30"))   # only the start of a long clip is analyzed
SAMPLE_FPS = float(os.getenv("DEMO_SAMPLE_FPS", "4"))      # frames analyzed per second of video
CONFIDENCE = float(os.getenv("DETECTOR_CONFIDENCE", "0.25"))
IOU = 0.45


class ModelNotInstalled(Exception):
    """The model file is not on this machine."""


class UnreadableVideo(Exception):
    """OpenCV could not open the upload as a video."""


_lock = threading.Lock()   # one video at a time keeps a small machine responsive
_session: Any = None
_names: dict[int, str] = {}
_input_name = ""
_size = 640


def _load() -> None:
    global _session, _names, _input_name, _size
    if _session is not None:
        return
    if not MODEL_PATH.is_file():
        raise ModelNotInstalled(str(MODEL_PATH))
    import onnxruntime as ort

    session = ort.InferenceSession(str(MODEL_PATH), providers=["CPUExecutionProvider"])
    meta = session.get_modelmeta().custom_metadata_map
    try:
        parsed = ast.literal_eval(meta.get("names", "{}"))
        _names = {int(k): str(v) for k, v in parsed.items()}
    except (ValueError, SyntaxError):
        _names = {}
    shape = session.get_inputs()[0].shape
    _size = shape[2] if isinstance(shape[2], int) else 640
    _input_name = session.get_inputs()[0].name
    _session = session


def _letterbox(img: np.ndarray, size: int) -> tuple[np.ndarray, float, int, int]:
    h, w = img.shape[:2]
    r = min(size / h, size / w)
    nh, nw = round(h * r), round(w * r)
    canvas = np.full((size, size, 3), 114, dtype=np.uint8)
    top, left = (size - nh) // 2, (size - nw) // 2
    canvas[top:top + nh, left:left + nw] = cv2.resize(img, (nw, nh))
    return canvas, r, left, top


def _infer(frame: np.ndarray) -> list[list[float]]:
    """Boxes as [x, y, w, h, confidence, class] in the frame's own pixels."""
    h0, w0 = frame.shape[:2]
    canvas, r, left, top = _letterbox(frame, _size)
    blob = cv2.dnn.blobFromImage(canvas, 1 / 255.0, (_size, _size), swapRB=True)
    out = _session.run(None, {_input_name: blob})[0][0]
    if out.shape[0] < out.shape[1]:          # (4 + classes, boxes) -> (boxes, 4 + classes)
        out = out.T
    scores = out[:, 4:]
    conf = scores.max(axis=1)
    cls = scores.argmax(axis=1)
    keep = conf >= CONFIDENCE
    if not keep.any():
        return []
    out, conf, cls = out[keep], conf[keep], cls[keep]
    cx, cy, w, h = out[:, 0], out[:, 1], out[:, 2], out[:, 3]
    x = (cx - w / 2 - left) / r
    y = (cy - h / 2 - top) / r
    boxes = np.stack([x, y, w / r, h / r], axis=1)
    picked = cv2.dnn.NMSBoxes(boxes.tolist(), conf.tolist(), CONFIDENCE, IOU)
    result = []
    for i in np.array(picked).flatten():
        bx, by, bw, bh = boxes[i]
        bx, by = max(0.0, float(bx)), max(0.0, float(by))
        bw, bh = min(float(bw), w0 - bx), min(float(bh), h0 - by)
        if bw > 1 and bh > 1:
            result.append([round(bx, 1), round(by, 1), round(bw, 1), round(bh, 1), round(float(conf[i]), 3), int(cls[i])])
    return result


class ConverterNotInstalled(Exception):
    """imageio-ffmpeg (which carries the ffmpeg program) is not installed."""


def convert_to_mp4(src: str, dst: str) -> None:
    """Re-encodes any video ffmpeg can read (MKV, AVI, a clip cut short in the
    middle, ...) as a small H.264 MP4 that every browser plays, and that the
    detector reads without trouble. Only the first MAX_SECONDS are kept, at most
    960 px wide, without sound."""
    try:
        import imageio_ffmpeg
        ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()
    except Exception as exc:  # the package or its bundled program is missing
        raise ConverterNotInstalled() from exc
    import subprocess

    cmd = [
        ffmpeg, "-y", "-v", "error", "-i", src,
        "-t", str(MAX_SECONDS), "-an",
        "-vf", "scale='min(960,iw)':-2",
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "28", "-pix_fmt", "yuv420p",
        "-movflags", "+faststart", dst,
    ]
    with _lock:
        try:
            subprocess.run(cmd, capture_output=True, timeout=300)
        except subprocess.TimeoutExpired as exc:
            raise UnreadableVideo() from exc
    # A clip cut off mid-way makes ffmpeg complain but still produce its start,
    # so the output file decides, not the exit code.
    if not os.path.isfile(dst) or os.path.getsize(dst) == 0:
        raise UnreadableVideo()


def detect_video(path: str) -> dict[str, Any]:
    with _lock:
        _load()
        cap = cv2.VideoCapture(path)
        if not cap.isOpened():
            raise UnreadableVideo()
        try:
            fps = cap.get(cv2.CAP_PROP_FPS) or 25.0
            width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
            height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
            total = cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0
            step = max(1, round(fps / SAMPLE_FPS))
            last = int(MAX_SECONDS * fps)
            frames: list[dict[str, Any]] = []
            i = 0
            while i < last and cap.grab():
                if i % step == 0:
                    ok, frame = cap.retrieve()
                    if ok:
                        frames.append({"t": round(i / fps, 3), "boxes": _infer(frame)})
                i += 1
        finally:
            cap.release()

    if not frames:
        raise UnreadableVideo()
    counts = [len(f["boxes"]) for f in frames]
    # Adds [bird number, state] to every box and works out inactive birds and huddles.
    behaviour = behavior.analyze(frames, width, height)
    return {
        "behavior": behaviour,
        "model": MODEL_PATH.name,
        "names": {str(k): v for k, v in _names.items()},
        "width": width,
        "height": height,
        "duration": round(total / fps, 2) if total else None,
        "analyzed_seconds": round(min(i, last) / fps, 2),
        "sample_fps": SAMPLE_FPS,
        "frames": frames,
        "summary": {
            "frames": len(frames),
            "frames_with_detections": sum(1 for c in counts if c),
            "max_per_frame": max(counts),
            "mean_per_frame": round(sum(counts) / len(counts), 2),
        },
    }
