"""
RTSP camera capture manager.

Maintains one OpenCV VideoCapture per configured RTSP source.
Provides thread-safe frame grabbing with automatic reconnection
and an MJPEG generator that yields JPEG frames.
"""

import logging
import os
import threading
import time
from typing import Generator

import cv2
import numpy as np

import camera_config

logger = logging.getLogger(__name__)

#: Opening an RTSP stream that is unreachable blocks inside FFmpeg until it
#: gives up, which can take half a minute. The analyser and the sampler wait
#: on that open, so the caller's own timeout expires first and the failure is
#: reported as "service unavailable" when the service is perfectly healthy.
#: Bounding the open (and each read) keeps a dead camera a fast, honest error.
_OPEN_TIMEOUT_MS = int(os.getenv("RTSP_OPEN_TIMEOUT_MS", "5000"))
_READ_TIMEOUT_MS = int(os.getenv("RTSP_READ_TIMEOUT_MS", "5000"))

#: What the Settings "Test link" button may point us at. Anything else (a file,
#: a device path) would be asking the service to read something it was never
#: meant to touch, so it is refused before OpenCV sees it.
_SOURCE_SCHEMES = ("rtsp://", "rtsps://", "http://", "https://")


def probe_source(url: str) -> dict:
    """
    Open a camera URL once, read one frame, and report what came back.

    Opening is the whole question: an RTSP link with one wrong character looks
    identical on screen, and the difference between "the camera is off" and
    "the link is wrong" is only visible from here. The open and read timeouts
    are the same ones grab_frame uses, so a dead link answers in seconds
    instead of holding the request until the camera gives up.
    """
    target = (url or "").strip()
    if not target.lower().startswith(_SOURCE_SCHEMES):
        return {"ok": False, "error": "not an rtsp:// or http:// link"}

    started = time.monotonic()
    cap = cv2.VideoCapture()
    try:
        if hasattr(cv2, "CAP_PROP_OPEN_TIMEOUT_MSEC"):
            cap.open(
                target,
                cv2.CAP_FFMPEG,
                [
                    cv2.CAP_PROP_OPEN_TIMEOUT_MSEC,
                    _OPEN_TIMEOUT_MS,
                    cv2.CAP_PROP_READ_TIMEOUT_MSEC,
                    _READ_TIMEOUT_MS,
                ],
            )
        else:
            cap.open(target, cv2.CAP_FFMPEG)

        if not cap.isOpened():
            return {"ok": False, "error": "the camera did not answer on that link"}

        ok, frame = cap.read()
        if not ok or frame is None:
            return {"ok": False, "error": "the link opened but sent no picture"}

        height, width = frame.shape[:2]
        return {
            "ok": True,
            "width": int(width),
            "height": int(height),
            "ms": int((time.monotonic() - started) * 1000),
        }
    finally:
        cap.release()


class CameraManager:
    """Manages RTSP camera connections and frame capture."""

    def __init__(self, sources: dict[str, str], target_fps: int = 15):
        """
        Args:
            sources: Mapping of camera_id -> RTSP URL.
            target_fps: Target frame rate for MJPEG streaming.
        """
        self._sources = sources
        self._target_fps = target_fps
        self._captures: dict[str, cv2.VideoCapture] = {}
        # Reentrant on purpose: grab_frame holds this lock and calls connect(),
        # which takes it again. With a plain Lock that second acquisition never
        # returns, so any camera that was not already open hung the caller
        # forever — a plain "camera offline" looked exactly like a dead service.
        self._locks: dict[str, threading.RLock] = {}
        self._frame_interval = 1.0 / target_fps

        for camera_id in sources:
            self._locks[camera_id] = threading.RLock()

    def connect(self, camera_id: str) -> bool:
        """Open (or reopen) the RTSP capture for a given camera."""
        url = self._sources.get(camera_id)
        if not url:
            logger.error("No RTSP source configured for camera %s", camera_id)
            return False

        lock = self._locks.setdefault(camera_id, threading.RLock())
        with lock:
            # Release any existing capture
            existing = self._captures.pop(camera_id, None)
            if existing is not None:
                existing.release()

            cap = cv2.VideoCapture()
            # The timeouts are only accepted by the overload that takes the
            # backend explicitly, and only by OpenCV 4.5.1 and later.
            if hasattr(cv2, "CAP_PROP_OPEN_TIMEOUT_MSEC"):
                cap.open(
                    url,
                    cv2.CAP_FFMPEG,
                    [
                        cv2.CAP_PROP_OPEN_TIMEOUT_MSEC,
                        _OPEN_TIMEOUT_MS,
                        cv2.CAP_PROP_READ_TIMEOUT_MSEC,
                        _READ_TIMEOUT_MS,
                    ],
                )
            else:
                cap.open(url, cv2.CAP_FFMPEG)
            if not cap.isOpened():
                # The login stays out of the log: it is the camera's password,
                # and a log is copied into bug reports.
                logger.warning(
                    "Failed to connect to RTSP source for %s: %s",
                    camera_id,
                    camera_config.redact_url(url),
                )
                return False

            # Optimise for low-latency live streaming
            cap.set(cv2.CAP_PROP_BUFFERSIZE, 2)
            self._captures[camera_id] = cap
            logger.info("Connected camera %s -> %s", camera_id, camera_config.redact_url(url))
            return True

    def connect_all(self) -> dict[str, bool]:
        """Attempt to connect every configured source."""
        return {cid: self.connect(cid) for cid in self._sources}

    def disconnect(self, camera_id: str) -> None:
        """Release the capture for a camera."""
        lock = self._locks.get(camera_id)
        if lock is None:
            return
        with lock:
            cap = self._captures.pop(camera_id, None)
            if cap is not None:
                cap.release()

    def disconnect_all(self) -> None:
        """Release all captures."""
        for cid in list(self._captures):
            self.disconnect(cid)

    def is_connected(self, camera_id: str) -> bool:
        """Check whether a camera is currently connected."""
        cap = self._captures.get(camera_id)
        return cap is not None and cap.isOpened()

    def status(self) -> list[dict]:
        """Return a status summary for every configured camera.

        The link is redacted: these rows travel to the dashboard, and the
        camera's password has no business there.
        """
        result = []
        for cid, url in self._sources.items():
            result.append({
                "camera_id": cid,
                "rtsp_url": camera_config.redact_url(url),
                "connected": self.is_connected(cid),
            })
        return result

    # ------------------------------------------------------------------
    # Frame capture
    # ------------------------------------------------------------------

    def grab_frame(self, camera_id: str) -> np.ndarray | None:
        """
        Grab a single frame from the camera.

        Returns the BGR numpy array, or None on failure.  Automatically
        attempts one reconnect if the capture is stale.
        """
        lock = self._locks.get(camera_id)
        if lock is None:
            return None

        with lock:
            cap = self._captures.get(camera_id)
            if cap is None or not cap.isOpened():
                if not self.connect(camera_id):
                    return None
                cap = self._captures.get(camera_id)
                if cap is None:
                    return None

            ok, frame = cap.read()
            if not ok or frame is None:
                # Try reconnect once
                logger.warning("Frame grab failed for %s, reconnecting…", camera_id)
                if not self.connect(camera_id):
                    return None
                cap = self._captures.get(camera_id)
                if cap is None:
                    return None
                ok, frame = cap.read()
                if not ok or frame is None:
                    return None

            return frame

    def grab_jpeg(
        self, camera_id: str, quality: int = 80
    ) -> bytes | None:
        """Grab a frame and encode it as JPEG bytes."""
        frame = self.grab_frame(camera_id)
        if frame is None:
            return None
        ok, buf = cv2.imencode(
            ".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, quality]
        )
        if not ok:
            return None
        return buf.tobytes()

    # ------------------------------------------------------------------
    # MJPEG streaming
    # ------------------------------------------------------------------

    def mjpeg_generator(
        self,
        camera_id: str,
        quality: int = 80,
        boundary: str = "frame",
    ) -> Generator[bytes, None, None]:
        """
        Yield multipart MJPEG frames suitable for an HTTP response
        with Content-Type ``multipart/x-mixed-replace; boundary=<boundary>``.
        """
        while True:
            jpeg = self.grab_jpeg(camera_id, quality)
            if jpeg is None:
                # Send a black placeholder frame so the stream doesn't stall
                placeholder = np.zeros((480, 640, 3), dtype=np.uint8)
                cv2.putText(
                    placeholder,
                    f"Camera {camera_id} - No Signal",
                    (40, 240),
                    cv2.FONT_HERSHEY_SIMPLEX,
                    0.8,
                    (100, 100, 100),
                    2,
                )
                ok, buf = cv2.imencode(
                    ".jpg",
                    placeholder,
                    [cv2.IMWRITE_JPEG_QUALITY, quality],
                )
                jpeg = buf.tobytes() if ok else b""

            if jpeg:
                yield (
                    f"--{boundary}\r\n"
                    "Content-Type: image/jpeg\r\n"
                    f"Content-Length: {len(jpeg)}\r\n\r\n"
                ).encode("utf-8") + jpeg + b"\r\n"

            time.sleep(self._frame_interval)

    def get_sources(self) -> dict[str, str]:
        """Return the configured source map."""
        return dict(self._sources)
