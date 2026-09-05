"""
RTSP camera capture manager.

Maintains one OpenCV VideoCapture per configured RTSP source.
Provides thread-safe frame grabbing with automatic reconnection
and an MJPEG generator that yields JPEG frames.
"""

import logging
import threading
import time
from typing import Generator

import cv2
import numpy as np

logger = logging.getLogger(__name__)


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
        self._locks: dict[str, threading.Lock] = {}
        self._frame_interval = 1.0 / target_fps

        for camera_id in sources:
            self._locks[camera_id] = threading.Lock()

    def connect(self, camera_id: str) -> bool:
        """Open (or reopen) the RTSP capture for a given camera."""
        url = self._sources.get(camera_id)
        if not url:
            logger.error("No RTSP source configured for camera %s", camera_id)
            return False

        lock = self._locks.setdefault(camera_id, threading.Lock())
        with lock:
            # Release any existing capture
            existing = self._captures.pop(camera_id, None)
            if existing is not None:
                existing.release()

            cap = cv2.VideoCapture(url, cv2.CAP_FFMPEG)
            if not cap.isOpened():
                logger.warning(
                    "Failed to connect to RTSP source for %s: %s",
                    camera_id,
                    url,
                )
                return False

            # Optimise for low-latency live streaming
            cap.set(cv2.CAP_PROP_BUFFERSIZE, 2)
            self._captures[camera_id] = cap
            logger.info("Connected camera %s -> %s", camera_id, url)
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
        """Return a status summary for every configured camera."""
        result = []
        for cid, url in self._sources.items():
            result.append({
                "camera_id": cid,
                "rtsp_url": url,
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
