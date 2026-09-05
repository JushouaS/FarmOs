"""
CereBroiler Vision Service — Flask application.

Provides endpoints for live MJPEG streaming from RTSP cameras,
single-frame capture, and full CV analysis (detections, behaviour,
weight estimation, cluster warnings).

All endpoints accept an internal service token (set via
VISION_SERVICE_TOKEN) for Fastify-to-Flask authentication.

Endpoints:
    GET  /health              — service health check
    GET  /cameras             — list configured camera sources
    GET  /stream/<camera_id>  — MJPEG multipart stream
    POST /capture/<camera_id> — single JPEG frame + metadata
    POST /analyze/<camera_id> — full CV pipeline + DB write
"""

import base64
import logging
import os
import sys

from dotenv import load_dotenv
from flask import Flask, Response, jsonify, request

# Load .env before anything else
load_dotenv()

from camera import CameraManager
from detector import Detector
import db as db_writer

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

FLASK_HOST = os.getenv("FLASK_HOST", "127.0.0.1")
FLASK_PORT = int(os.getenv("FLASK_PORT", "5000"))
DATABASE_URL = os.getenv("DATABASE_URL", "")
SERVICE_TOKEN = os.getenv("VISION_SERVICE_TOKEN", "dev-vision-token-change-in-production")

# Parse RTSP sources: "camera_id=url,camera_id=url" or "url1,url2" (auto-named)
_raw_sources = os.getenv("RTSP_SOURCES", "")
_sources: dict[str, str] = {}
for idx, part in enumerate(_raw_sources.split(",")):
    part = part.strip()
    if not part:
        continue
    if "=" in part:
        cid, url = part.split("=", 1)
        _sources[cid.strip()] = url.strip()
    else:
        _sources[f"camera_{idx:02d}"] = part

# ---------------------------------------------------------------------------
# App setup
# ---------------------------------------------------------------------------

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)-8s %(name)s  %(message)s",
    stream=sys.stdout,
)
logger = logging.getLogger("vision")

app = Flask(__name__)

# Global instances
cameras = CameraManager(sources=_sources)
detector = Detector()


# ---------------------------------------------------------------------------
# Auth middleware
# ---------------------------------------------------------------------------

@app.before_request
def check_service_token():
    """Validate the internal service token on every request."""
    # Health check is open
    if request.path == "/health":
        return None

    token = request.headers.get("X-Vision-Token", "")
    if token != SERVICE_TOKEN:
        return jsonify({"error": "unauthorized"}), 401
    return None


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@app.route("/health")
def health():
    """Return service status."""
    return jsonify({
        "status": "ok",
        "cameras_configured": len(_sources),
        "cameras_connected": sum(
            1 for cid in _sources if cameras.is_connected(cid)
        ),
    })


@app.route("/cameras")
def list_cameras():
    """List all configured camera sources and their connection status."""
    return jsonify(cameras.status())


@app.route("/stream/<camera_id>")
def stream(camera_id: str):
    """
    MJPEG multipart stream.

    The response uses Content-Type ``multipart/x-mixed-replace``
    which the browser's ``<img>`` tag handles natively for live
    video display.
    """
    if camera_id not in _sources:
        return jsonify({"error": "unknown_camera", "camera_id": camera_id}), 404

    # Ensure the camera is connected
    if not cameras.is_connected(camera_id):
        cameras.connect(camera_id)

    return Response(
        cameras.mjpeg_generator(camera_id),
        mimetype="multipart/x-mixed-replace; boundary=frame",
        headers={
            "Cache-Control": "no-cache, no-store, must-revalidate",
            "X-Accel-Buffering": "no",  # nginx passthrough
        },
    )


@app.route("/capture/<camera_id>", methods=["POST"])
def capture(camera_id: str):
    """
    Capture a single JPEG frame from the camera.

    Returns a JSON object with:
      - ``image``: base64-encoded JPEG
      - ``camera_id``: the camera identifier
      - ``connected``: whether the camera was connected
    """
    if camera_id not in _sources:
        return jsonify({"error": "unknown_camera", "camera_id": camera_id}), 404

    jpeg_bytes = cameras.grab_jpeg(camera_id, quality=85)
    if jpeg_bytes is None:
        return jsonify({"error": "frame_grab_failed", "camera_id": camera_id}), 503

    return jsonify({
        "camera_id": camera_id,
        "connected": cameras.is_connected(camera_id),
        "image": base64.b64encode(jpeg_bytes).decode("ascii"),
        "content_type": "image/jpeg",
        "size_bytes": len(jpeg_bytes),
    })


@app.route("/analyze/<camera_id>", methods=["POST"])
def analyze(camera_id: str):
    """
    Run the full CV pipeline on the latest frame.

    1. Grab a frame from the RTSP source.
    2. Run bird detection (bounding boxes + behaviour labels).
    3. Derive behaviour snapshot (movement, huddling, aggression).
    4. Estimate weight from detection data.
    5. Detect spatial clusters (huddling).
    6. Write all results to PostgreSQL.
    7. Return structured JSON.
    """
    if camera_id not in _sources:
        return jsonify({"error": "unknown_camera", "camera_id": camera_id}), 404

    # 1. Grab frame
    frame = cameras.grab_frame(camera_id)
    if frame is None:
        return jsonify({"error": "frame_grab_failed", "camera_id": camera_id}), 503

    # 2. Detect
    detections = detector.detect(frame)

    # 3. Behaviour
    behaviour = detector.analyze_behaviour(detections)

    # 4. Weight
    weight = detector.estimate_weight(detections)

    # 5. Clusters
    clusters = detector.detect_clusters(detections)

    # 6. Write to DB
    db_ok = True
    try:
        db_writer.write_detections(camera_id, detections)
        db_writer.write_behaviour_snapshot(camera_id, behaviour)
        for c in clusters:
            db_writer.write_cluster_warning(camera_id, c)
        if weight:
            db_writer.write_volumetric_sample(
                camera_id,
                weight.median_g,
                weight.std_dev_g,
                weight.sample_size,
                weight.confidence,
            )
        # Prune stale rows
        db_writer.prune_old_detections(camera_id)
    except Exception as exc:
        logger.error("Database write failed: %s", exc)
        db_ok = False

    # 7. Return results
    return jsonify({
        "camera_id": camera_id,
        "db_written": db_ok,
        "detections": [d.to_dict() for d in detections],
        "detection_count": len(detections),
        "behaviour": behaviour.to_dict(),
        "weight": weight.to_dict() if weight else None,
        "clusters": [c.to_dict() for c in clusters],
        "cluster_count": len(clusters),
    })


# ---------------------------------------------------------------------------
# Lifecycle
# ---------------------------------------------------------------------------

@app.before_request
def _ensure_db():
    """Lazy-init the DB pool on the first request that needs it."""
    if db_writer._pool is None and DATABASE_URL:
        try:
            db_writer.init_pool(DATABASE_URL)
        except Exception as exc:
            logger.warning("Database pool init deferred: %s", exc)


@app.teardown_appcontext
def _teardown(exc):
    pass


def _shutdown():
    """Clean up resources on exit."""
    logger.info("Shutting down vision service…")
    cameras.disconnect_all()
    db_writer.close_pool()


import atexit
atexit.register(_shutdown)


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    logger.info(
        "Starting CereBroiler Vision Service on %s:%d",
        FLASK_HOST,
        FLASK_PORT,
    )
    logger.info("Configured cameras: %s", list(_sources.keys()))

    # Attempt initial connections
    results = cameras.connect_all()
    for cid, ok in results.items():
        logger.info("  Camera %s: %s", cid, "connected" if ok else "FAILED")

    # Initialise DB pool
    if DATABASE_URL:
        try:
            db_writer.init_pool(DATABASE_URL)
        except Exception as exc:
            logger.warning("Could not connect to database at startup: %s", exc)
            logger.warning("DB writes will be retried on first request.")

    app.run(
        host=FLASK_HOST,
        port=FLASK_PORT,
        debug=False,
        threaded=True,
    )
