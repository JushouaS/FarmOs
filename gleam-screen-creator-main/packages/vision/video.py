"""
Uploaded clips, for testing the behaviour analysis without a camera.

Why this exists: the analysis can only be trusted once it has been run against
footage somebody knows the answer to, and the camera is not always available —
it is on the far side of a bad link, the flock is asleep, or a model has just
been swapped and nobody wants to wait until morning to find out whether it
works.

A clip is decoded here and fed through exactly the measurement code the live
camera feeds: the same detector, the same frame-pair motion, the same zones and
the same clustering. Nothing is persisted — a recording is not a reading, and
its timestamps belong to no day this flock lived through, so writing them into
behavior_snapshots would put invented history in front of whoever reads the
trend next.

Two things worth knowing before changing this file:

1. The upload's extension is only a hint. A file is accepted once OpenCV can
   actually open it and report a duration; anything else is refused, so a
   renamed chat sticker fails here instead of halfway through a sweep.
2. Measurements are taken from two frames a known distance apart *within the
   file*. Seeking to the same instant twice would compare a frame with itself,
   which reads as an utterly motionless flock — the exact false alarm this
   whole feature is meant to help detect.
"""

import logging
import os
import threading
import time
import uuid
from dataclasses import dataclass
from urllib.parse import unquote

import cv2
import numpy as np

logger = logging.getLogger(__name__)

#: Where clips live. Ephemeral on purpose: they are test artefacts, not data,
#: and a container restart forgetting them is the correct outcome.
STORE_DIR = os.getenv("VIDEO_STORE_DIR", "/tmp/cerebroil-video")
MAX_MB = int(os.getenv("VIDEO_MAX_MB", "2560"))
MAX_BYTES = MAX_MB * 1024 * 1024
MAX_SECONDS = float(os.getenv("VIDEO_MAX_SECONDS", "3600"))
TTL_SECONDS = float(os.getenv("VIDEO_TTL_MINUTES", "120")) * 60
MAX_SAMPLES = int(os.getenv("VIDEO_SWEEP_SAMPLES", "30"))

CHUNK = 1024 * 1024
ALLOWED_EXT = (".mp4", ".avi", ".mov", ".mkv", ".m4v", ".webm")


class ClipError(ValueError):
    """An upload that cannot be used, with the reason the operator needs."""

    def __init__(self, code: str, message: str, status: int = 400):
        super().__init__(message)
        self.code = code
        self.message = message
        self.status = status


@dataclass
class Clip:
    """One stored clip. `path` is internal; the rest is what the UI shows."""

    id: str
    name: str
    path: str
    duration: float
    fps: float
    width: int
    height: int
    bytes: int
    created: float

    def as_dict(self) -> dict:
        return {
            "id": self.id,
            "name": self.name,
            "duration_s": round(self.duration, 2),
            "fps": round(self.fps, 2),
            "width": self.width,
            "height": self.height,
            "bytes": self.bytes,
            "max_samples": MAX_SAMPLES,
        }


_clips: dict[str, Clip] = {}
_lock = threading.Lock()


def purge_expired() -> int:
    """Forget clips past their TTL. Called on the way into every other entry point."""
    cutoff = time.time() - TTL_SECONDS
    removed = 0
    with _lock:
        for clip_id in [c.id for c in _clips.values() if c.created < cutoff]:
            _discard(clip_id)
            removed += 1
    if removed:
        logger.info("Removed %d expired test clip(s)", removed)
    return removed


def _discard(clip_id: str) -> None:
    """Drop a clip from the registry and disk. Caller holds the lock."""
    clip = _clips.pop(clip_id, None)
    if clip is None:
        return
    try:
        os.unlink(clip.path)
    except OSError:
        # Already gone, or the directory went with the container. Either way
        # there is nothing left to clean up.
        pass


def count() -> int:
    with _lock:
        return len(_clips)


def get(clip_id: str) -> Clip | None:
    purge_expired()
    with _lock:
        return _clips.get(clip_id)


def remove(clip_id: str) -> bool:
    with _lock:
        if clip_id not in _clips:
            return False
        _discard(clip_id)
        return True


# ---------------------------------------------------------------------------
# Ingest
# ---------------------------------------------------------------------------

def save(stream, filename: str) -> Clip:
    """
    Write an uploaded clip to disk and describe it.

    `stream` only has to support `read(n)`; the caller's request body is not
    buffered in memory anywhere on this path.
    """
    # Percent-encoded on the way in: an HTTP header cannot carry non-Latin-1,
    # and "aso't manok (final).mp4" should not arrive mangled.
    name = unquote(filename or "clip").strip()[:120] or "clip"
    ext = os.path.splitext(name)[1].lower()
    if ext not in ALLOWED_EXT:
        raise ClipError(
            "unsupported_type",
            f"Only {', '.join(ALLOWED_EXT)} can be read here.",
            415,
        )

    os.makedirs(STORE_DIR, exist_ok=True)
    clip_id = uuid.uuid4().hex[:16]
    path = os.path.join(STORE_DIR, clip_id + ext)

    written = 0
    try:
        with open(path, "wb") as fh:
            while True:
                chunk = stream.read(CHUNK)
                if not chunk:
                    break
                written += len(chunk)
                if written > MAX_BYTES:
                    raise ClipError(
                        "too_large",
                        f"The clip is larger than the {MAX_MB} MB limit.",
                        413,
                    )
                fh.write(chunk)
        if written == 0:
            raise ClipError("empty_upload", "The upload contained no data.", 400)
        clip = _probe(clip_id, path, name, written)
    except ClipError:
        _unlink_quietly(path)
        raise
    except Exception:
        _unlink_quietly(path)
        raise

    purge_expired()
    with _lock:
        _clips[clip_id] = clip
    logger.info(
        "Test clip %s stored: %s, %.1fs, %dx%d, %d bytes",
        clip_id, clip.name, clip.duration, clip.width, clip.height, clip.bytes,
    )
    return clip


def _unlink_quietly(path: str) -> None:
    try:
        os.unlink(path)
    except OSError:
        pass


def _probe(clip_id: str, path: str, name: str, written: int) -> Clip:
    """Read the container's own numbers, and refuse a file that will not play."""
    cap = cv2.VideoCapture(path)
    try:
        if not cap.isOpened():
            raise ClipError(
                "unreadable_clip",
                "The file could not be opened as a video. Re-export it as H.264 MP4.",
                415,
            )
        fps = float(cap.get(cv2.CAP_PROP_FPS) or 0.0)
        frames = float(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0.0)
        width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH) or 0)
        height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT) or 0)
    finally:
        cap.release()

    if fps <= 0 or frames <= 0:
        raise ClipError(
            "unreadable_clip",
            "The file opened but has no usable frame count or frame rate.",
            415,
        )

    duration = frames / fps
    if duration > MAX_SECONDS:
        raise ClipError(
            "too_long",
            f"The clip runs {duration:.0f}s; the limit is {MAX_SECONDS:.0f}s.",
            413,
        )

    return Clip(
        id=clip_id,
        name=name,
        path=path,
        duration=duration,
        fps=fps,
        width=width,
        height=height,
        bytes=written,
        created=time.time(),
    )


# ---------------------------------------------------------------------------
# Reading frames
# ---------------------------------------------------------------------------

def _seek(cap: cv2.VideoCapture, t: float) -> None:
    """Position the decoder. Negative times are clamped to the first frame."""
    cap.set(cv2.CAP_PROP_POS_MSEC, max(0.0, t) * 1000.0)


def pair(clip: Clip, t: float, delta_ms: int) -> tuple[np.ndarray | None, np.ndarray | None]:
    """
    Two frames `delta_ms` apart inside the clip, for one measurement.

    Returns (None, None) when there is nothing to compare — a seek past the end,
    or a clip that ends before the second frame. Reporting a motionless flock
    from a frame compared with itself would be worse than reporting nothing.
    """
    advance = max(1, int(round((delta_ms / 1000.0) * clip.fps)))

    cap = cv2.VideoCapture(clip.path)
    try:
        return _pair_from(cap, t, advance)
    finally:
        cap.release()


def _pair_from(
    cap: cv2.VideoCapture, t: float, advance: int
) -> tuple[np.ndarray | None, np.ndarray | None]:
    if not cap.isOpened():
        return None, None
    _seek(cap, t)
    ok, first = cap.read()
    if not ok or first is None:
        return None, None

    second = None
    for _ in range(advance):
        ok, frame = cap.read()
        if not ok or frame is None:
            break
        second = frame

    if second is None or second.shape != first.shape:
        return None, None
    return first, second


def frame_at(clip: Clip, t: float):
    """One frame at `t`, or None if the clip cannot produce it."""
    cap = cv2.VideoCapture(clip.path)
    try:
        if not cap.isOpened():
            return None
        _seek(cap, t)
        ok, frame = cap.read()
        return frame if ok and frame is not None else None
    finally:
        cap.release()


def sample_times(clip: Clip, count: int, delta_ms: int, max_samples: int | None = None) -> list[float]:
    """
    Where to sample a clip of this length.

    Kept clear of the first and last half-second: clips are usually cut a little
    before and after the interesting part, and a frame from the very end cannot
    be paired with one a delta later anyway.

    `max_samples` lets a caller take more than the sweep's cap — the weights
    pass needs one frame per sample instead of a pair, so it can afford more.
    """
    count = max(1, min(int(count or 1), max_samples or MAX_SAMPLES))
    margin = min(1.0, clip.duration * 0.05)
    start = margin
    end = clip.duration - max(delta_ms / 1000.0, margin)
    if end <= start:
        # A clip shorter than one frame pair. One sample from the middle is all
        # the honest answer there is.
        return [round(clip.duration / 2.0, 2)]
    if count == 1:
        return [round(start, 2)]
    step = (end - start) / (count - 1)
    return [round(start + i * step, 2) for i in range(count)]


def encode_jpeg(frame: np.ndarray, quality: int = 85) -> bytes | None:
    ok, buf = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, quality])
    return buf.tobytes() if ok else None


# ---------------------------------------------------------------------------
# Drawing
# ---------------------------------------------------------------------------

#: BGR, matching what the boxes mean rather than what looks pretty.
_COLOURS = {
    "active": (110, 200, 90),
    "inactive": (60, 170, 240),
    "feeding": (200, 160, 80),
    "unknown": (170, 170, 170),
}
_HUDDLE = (70, 70, 220)


def annotate(frame: np.ndarray, detections: list) -> np.ndarray:
    """
    Draw what the model found, so "it sees nothing" and "it sees the wrong
    thing" stop looking the same in a screenshot.
    """
    out = frame.copy()
    for det in detections:
        x = int(round(det.box_x))
        y = int(round(det.box_y))
        w = int(round(det.box_w))
        h = int(round(det.box_h))
        colour = _HUDDLE if det.flag == "huddled" else _COLOURS.get(det.behavior, _COLOURS["unknown"])
        cv2.rectangle(out, (x, y), (x + w, y + h), colour, 2)
        if det.zone:
            cv2.putText(
                out, "feeder", (x, max(12, y - 6)),
                cv2.FONT_HERSHEY_SIMPLEX, 0.45, colour, 1, cv2.LINE_AA,
            )
        elif det.flag == "huddled":
            cv2.putText(
                out, "huddle", (x, max(12, y + h + 14)),
                cv2.FONT_HERSHEY_SIMPLEX, 0.45, colour, 1, cv2.LINE_AA,
            )
    return out
