"""
CereBroiler Vision Service — Flask application.

Owns the cameras: the live MJPEG stream, single-frame capture, and the
measurements behind the behaviour labels.

What it deliberately does NOT do any more is write results to the database.
It used to, and that copy had gone stale — it omitted the detection id and
named columns that do not exist, so every write threw. Persisting is now the
API's job, which is also where the thresholds and the night rule live, so
there is one place that decides what a number means and one place that
records it.

Endpoints:
    GET  /health              — service health, including whether a model loaded
    GET  /cameras             — list configured camera sources
    POST /source/test         — can this RTSP link be opened at all? (Settings)
    GET  /stream/<camera_id>  — MJPEG multipart stream
    POST /capture/<camera_id> — single JPEG frame + metadata
    POST /analyze/<camera_id> — one measurement pass (detections, counts)
    POST /zones/refresh       — drop the cached zone polygons

    POST /video               — store an uploaded clip for testing
    GET  /video/<clip_id>     — what the stored clip is
    GET  /video/<id>/frame    — one frame of it, optionally with boxes drawn
    POST /video/<id>/analyze  — one measurement on that clip
    POST /video/<id>/sweep    — the same measurement across the whole clip
    POST /video/<id>/weights  — the depth-to-mass estimate across the clip
    DELETE /video/<clip_id>   — forget it
"""

import atexit
import base64
import logging
import os
import sys
import threading
import time

from dotenv import load_dotenv
from flask import Flask, Response, jsonify, request

# Load .env before anything else
load_dotenv()

from camera import CameraManager, probe_source
from detector import Detector, analyse_pair
import camera_config
import video as clip_store
import weight
import zones as zone_store

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

FLASK_HOST = os.getenv("FLASK_HOST", "127.0.0.1")
FLASK_PORT = int(os.getenv("FLASK_PORT", "5000"))
SERVICE_TOKEN = os.getenv("VISION_SERVICE_TOKEN", "dev-vision-token-change-in-production")

#: How far apart the two frames of one measurement are. Long enough that a
#: slow bird still registers a pixel change, short enough that the flock has
#: not rearranged itself in between.
FRAME_DELTA_MS = int(os.getenv("VISION_FRAME_DELTA_MS", "700"))

#: Which camera's saved feeder polygons a clip is tested against. A clip has
#: no zones of its own, and answering the exclusion question against polygons
#: the camera does not use would be answering a question nobody asked.
VIDEO_ZONE_CAMERA = os.getenv("VIDEO_ZONE_CAMERA", "CAM-01")

#: How long one sweep may run before it returns the samples it finished.
#: A long clip on a slow machine must not hold a connection open indefinitely.
VIDEO_SWEEP_BUDGET_S = float(os.getenv("VIDEO_SWEEP_BUDGET_S", "90"))

#: How often the service asks whether Settings changed the camera link. A save
#: therefore reaches the frame grabs within this plus one database round trip.
CONFIG_POLL_SECONDS = float(os.getenv("CAMERA_CONFIG_POLL_SECONDS", "10"))

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

# The cameras and their links: the one Settings stores, else RTSP_SOURCES from
# the environment (see camera_config.py). This very dict is what CameraManager
# holds, so a changed link reaches the connection attempts by being replaced in
# place — see apply_camera_config().
_sources: dict[str, str] = camera_config.read_sources()

# Global instances
cameras = CameraManager(sources=_sources)
detector = Detector()


# ---------------------------------------------------------------------------
# Auth middleware
# ---------------------------------------------------------------------------

@app.before_request
def check_service_token():
    """Validate the internal service token on every request."""
    # In the container this module is loaded by gunicorn, which never runs the
    # __main__ block below, so the first request is where the camera link
    # watcher gets started. It is idempotent and does nothing after the first.
    ensure_camera_config_loop()

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
    """Return service status, including whether detection can run at all."""
    return jsonify({
        "status": "ok",
        "cameras_configured": len(_sources),
        "cameras_connected": sum(
            1 for cid in _sources if cameras.is_connected(cid)
        ),
        "model_loaded": detector.available,
        "model_error": detector.load_error,
        "analysis_mode": "onnx" if detector.available else "unavailable",
        "video_clips": clip_store.count(),
    })


@app.route("/cameras")
def list_cameras():
    """List all configured camera sources and their connection status."""
    return jsonify(cameras.status())


@app.route("/source/test", methods=["POST"])
def test_source():
    """
    Open a candidate RTSP link and report what came back.

    The Settings page asks before saving: a link with one wrong character is
    indistinguishable from a camera that is switched off, and only this service
    can tell the two apart.
    """
    body = request.get_json(silent=True) or {}
    url = str(body.get("rtspUrl") or "").strip()
    if not url:
        return jsonify({"ok": False, "error": "no link given"}), 400
    logger.info("Testing camera link %s", camera_config.redact_url(url))
    result = probe_source(url)
    logger.info(
        "Test of %s: %s",
        camera_config.redact_url(url),
        "ok" if result.get("ok") else result.get("error"),
    )
    return jsonify(result)


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


def _grab_pair(camera_id: str):
    """
    Two frames a known distance apart, which is what makes motion measurable.

    A single frame can only say birds are there. Comparing two says which of
    them moved — that is the whole basis of the inactivity judgement.
    """
    first = cameras.grab_frame(camera_id)
    if first is None:
        return None, None

    time.sleep(FRAME_DELTA_MS / 1000.0)
    second = cameras.grab_frame(camera_id)

    if second is None:
        return None, None

    # A wedged decoder can hand back the same buffer twice, which would read
    # as a completely motionless flock. Give it one more chance before
    # believing that.
    if second.shape == first.shape and (second is first or (first == second).all()):
        time.sleep(FRAME_DELTA_MS / 1000.0)
        retry = cameras.grab_frame(camera_id)
        if retry is not None:
            first, second = second, retry

    return first, second


@app.route("/analyze/<camera_id>", methods=["POST"])
def analyze(camera_id: str):
    """
    One measurement pass: who is in the frame, who moved, who is packed tight.

    Returns raw counts and geometry. It does not decide whether the flock is
    huddling or whether it is night — the API applies those rules, because a
    single frame cannot tell a sleeping flock from a distressed one.
    """
    if camera_id not in _sources:
        return jsonify({"error": "unknown_camera", "camera_id": camera_id}), 404

    prev_frame, frame = _grab_pair(camera_id)
    if frame is None:
        return jsonify({"error": "frame_grab_failed", "camera_id": camera_id}), 503

    result = analyse_pair(camera_id, prev_frame, frame, detector)

    return jsonify({
        "camera_id": camera_id,
        # Kept as a field for the API's response shape; writing happens there.
        "db_written": False,
        "detections": [d.as_dict() for d in result.detections],
        "detection_count": len(result.detections),
        "metrics": result.metrics,
        "clusters": result.clusters,
        "cluster_count": len(result.clusters),
        "warnings": result.warnings,
        "weight": None,
    })


@app.route("/zones/refresh", methods=["POST"])
def refresh_zones():
    """
    Drop the cached feeder polygons.

    Called by the API right after an operator saves a redraw, so the change
    shows up on the next scan instead of waiting out the cache.
    """
    payload = request.get_json(silent=True) or {}
    camera_id = payload.get("camera_id")
    zone_store.invalidate(camera_id)
    return jsonify({"ok": True, "camera_id": camera_id})


# ---------------------------------------------------------------------------
# Uploaded clips — the same measurement, on footage instead of a live camera
# ---------------------------------------------------------------------------

def _time_param() -> float | None:
    """The `t` query parameter, in seconds, or None when it is not a number."""
    try:
        t = float(request.args.get("t", "0"))
    except (TypeError, ValueError):
        return None
    return t if t >= 0 else None


def _inline_zones() -> list | None:
    """
    Polygons optionally sent with a measurement, for testing a clip against a
    different set than the camera's saved one.

    Returns None when absent, which means "use the saved zones". An empty list
    is a real answer: test with no exclusion at all.
    """
    payload = request.get_json(silent=True) or {}
    raw = payload.get("zones")
    if raw is None:
        return None
    if not isinstance(raw, list):
        raise ValueError("zones must be a list of polygons")
    polygons = []
    for poly in raw:
        if not isinstance(poly, (list, tuple)) or len(poly) < 3:
            raise ValueError("each polygon needs at least 3 points")
        points = []
        for pt in poly:
            if not isinstance(pt, (list, tuple)) or len(pt) != 2:
                raise ValueError("polygon points must be [x, y] pairs")
            x, y = float(pt[0]), float(pt[1])
            if not (0.0 <= x <= 1.0 and 0.0 <= y <= 1.0):
                raise ValueError("polygon points must be within 0..1")
            points.append([x, y])
        polygons.append(points)
    return polygons


def _clip_or_404(clip_id: str):
    clip = clip_store.get(clip_id)
    if clip is None:
        return None, (jsonify({"error": "unknown_clip", "clip_id": clip_id}), 404)
    return clip, None


@app.route("/video", methods=["POST"])
def upload_video():
    """
    Store an uploaded clip.

    The body *is* the file and the name arrives in X-Filename, so nothing is
    parsed multipart-style and nothing is buffered in memory: the bytes go
    straight from the socket to disk under a size cap.
    """
    try:
        clip = clip_store.save(
            request.stream,
            request.headers.get("X-Filename", "clip.mp4"),
        )
    except clip_store.ClipError as err:
        return jsonify({"error": err.code, "detail": err.message}), err.status
    return jsonify(clip.as_dict())


@app.route("/video/<clip_id>", methods=["GET"])
def video_info(clip_id: str):
    clip, missing = _clip_or_404(clip_id)
    if missing:
        return missing
    return jsonify(clip.as_dict())


@app.route("/video/<clip_id>", methods=["DELETE"])
def video_delete(clip_id: str):
    if not clip_store.remove(clip_id):
        return jsonify({"error": "unknown_clip", "clip_id": clip_id}), 404
    return jsonify({"ok": True, "clip_id": clip_id})


@app.route("/video/<clip_id>/frame", methods=["GET"])
def video_frame(clip_id: str):
    """
    One frame of the clip as JPEG.

    With ?annotate=1 the detector's boxes are drawn on it, which is the fastest
    way to tell "the model sees nothing" from "the model sees the wrong thing".
    """
    clip, missing = _clip_or_404(clip_id)
    if missing:
        return missing

    t = _time_param()
    if t is None:
        return jsonify({"error": "invalid_time"}), 400

    frame = clip_store.frame_at(clip, t)
    if frame is None:
        return jsonify({"error": "video_frame_unavailable", "t": t}), 422

    if request.args.get("annotate") in ("1", "true", "yes"):
        frame = clip_store.annotate(frame, detector.detect(frame))

    jpeg = clip_store.encode_jpeg(frame)
    if jpeg is None:
        return jsonify({"error": "encode_failed"}), 500
    return Response(
        jpeg,
        mimetype="image/jpeg",
        headers={"Cache-Control": "no-store"},
    )


@app.route("/video/<clip_id>/bird-weights", methods=["POST"])
def video_bird_weights(clip_id: str):
    """
    Per-bird weights from an ordinary colour picture at one moment, from the size of each bird's box.

    The scale (grams per unit of size) depends on how high the camera is, so it comes from the camera position: the clip's
    background is compared with the references stored in size_calibration.json, and the matching position's scale is used. The
    weights are then absolute and their average is a result. When the position is not one of the stored ones the answer is
    camera_position_unknown, and the caller can give `mean_g` (the flock's average weight, grams) to calibrate by instead; then
    the average is an input. A rough guide, see weight.size_weights. Nothing is stored.
    """
    clip, missing = _clip_or_404(clip_id)
    if missing:
        return missing

    t = _time_param()
    if t is None:
        return jsonify({"error": "invalid_time"}), 400
    mean_g = None
    if request.args.get("mean_g", "") != "":
        try:
            mean_g = float(request.args.get("mean_g", ""))
        except (TypeError, ValueError):
            mean_g = float("nan")
        if not (weight.MEAN_G_RANGE[0] <= mean_g <= weight.MEAN_G_RANGE[1]):
            return jsonify({
                "error": "invalid_mean_weight",
                "detail": "Give the flock's average weight in grams, between %d and %d." % weight.MEAN_G_RANGE,
            }), 400
    if not detector.available:
        return jsonify({"error": "model_unavailable", "detail": detector.load_error}), 503

    frame = clip_store.frame_at(clip, t)
    if frame is None:
        return jsonify({"error": "video_frame_unavailable", "t": t}), 422

    calibration_info = {"mode": "typed_average"}
    grams_per_unit = None
    if mean_g is None:
        calibration = weight.load_calibration()
        if calibration is None:
            return jsonify({"error": "camera_position_unknown", "detail": "No size calibration is installed (size_calibration.json)."}), 422
        times = clip_store.sample_times(clip, 9, 0, max_samples=9)
        shots = [f for f in (clip_store.frame_at(clip, x) for x in times) if f is not None]
        position, best, runner = weight.identify_setup(weight.background_signature(shots or [frame]), calibration)
        if position is None:
            return jsonify({
                "error": "camera_position_unknown",
                "detail": "This video's camera position is not one the scale was learned for.",
                "match": round(best, 2),
            }), 422
        setup = calibration["setups"][position]
        grams_per_unit = float(setup["grams_per_size_unit"])
        calibration_info = {
            "mode": "camera_position",
            "position": position,
            "learned_from_days": setup["days"],
            "scale_spread_percent": setup.get("scale_spread_percent"),
            "match": round(best, 2),
            "other_match": round(runner, 2),
            "close_call": bool(best - runner < weight.CLEAR_MARGIN),
        }

    boxes = [(d.box_x, d.box_y, d.box_w, d.box_h) for d in detector.detect(frame)]
    height, width = frame.shape[:2]
    result = weight.size_weights(boxes, (width, height), mean_g=mean_g, grams_per_unit=grams_per_unit)
    jpeg = clip_store.encode_jpeg(weight.draw_weights(frame, boxes, result))
    if jpeg is None:
        return jsonify({"error": "encode_failed"}), 500

    return jsonify({
        "clip": clip.as_dict(),
        "t": t,
        "mean_g": mean_g,
        "calibration": calibration_info,
        "birds": [
            {"box": {"x": round(b[0], 1), "y": round(b[1], 1), "w": round(b[2], 1), "h": round(b[3], 1)}, **r}
            for b, r in zip(boxes, result["birds"])
        ],
        "summary": result["summary"],
        "content_type": "image/jpeg",
        "image": base64.b64encode(jpeg).decode("ascii"),
        "method": "size",
    })


@app.route("/video/<clip_id>/analyze", methods=["POST"])
def video_analyze(clip_id: str):
    """One measurement on the clip, in the same shape as a camera pass."""
    clip, missing = _clip_or_404(clip_id)
    if missing:
        return missing

    t = _time_param()
    if t is None:
        return jsonify({"error": "invalid_time"}), 400

    try:
        zones = _inline_zones()
    except ValueError as err:
        return jsonify({"error": "invalid_zones", "detail": str(err)}), 400

    prev_frame, frame = clip_store.pair(clip, t, FRAME_DELTA_MS)
    if frame is None:
        return jsonify({"error": "video_frame_unavailable", "t": t}), 422

    result = analyse_pair(VIDEO_ZONE_CAMERA, prev_frame, frame, detector, zones=zones)

    return jsonify({
        "clip": clip.as_dict(),
        "t": t,
        "zone_camera": VIDEO_ZONE_CAMERA,
        "db_written": False,
        "detections": [d.as_dict() for d in result.detections],
        "detection_count": len(result.detections),
        "metrics": result.metrics,
        "clusters": result.clusters,
        "cluster_count": len(result.clusters),
        "warnings": result.warnings,
    })


@app.route("/video/<clip_id>/sweep", methods=["POST"])
def video_sweep(clip_id: str):
    """
    The same measurement across the clip, evenly spaced.

    Only measurements come back; deciding what they mean stays in the API, so a
    clip is judged by the same thresholds and the same window as a live camera
    rather than by a second copy of the rules that could drift.
    """
    clip, missing = _clip_or_404(clip_id)
    if missing:
        return missing

    try:
        count = int(request.args.get("count", clip_store.MAX_SAMPLES))
    except (TypeError, ValueError):
        count = clip_store.MAX_SAMPLES

    times = clip_store.sample_times(clip, count, FRAME_DELTA_MS)
    deadline = time.monotonic() + VIDEO_SWEEP_BUDGET_S

    samples = []
    truncated = False
    for t in times:
        if time.monotonic() > deadline:
            truncated = True
            break
        # One decoder per sample: a seek costs milliseconds, and a decoder kept
        # open across a long sweep is one more thing to invalidate.
        prev_frame, frame = clip_store.pair(clip, t, FRAME_DELTA_MS)
        if frame is None:
            samples.append({"t": t, "metrics": None, "warnings": ["video_frame_unavailable"]})
            continue
        result = analyse_pair(VIDEO_ZONE_CAMERA, prev_frame, frame, detector)
        samples.append({"t": t, "metrics": result.metrics, "warnings": result.warnings})

    logger.info(
        "Swept clip %s: %d of %d samples%s",
        clip.id, len(samples), len(times), " (budget reached)" if truncated else "",
    )

    return jsonify({
        "clip": clip.as_dict(),
        "zone_camera": VIDEO_ZONE_CAMERA,
        "sampling": {
            "requested": count,
            "taken": len(samples),
            "truncated": truncated,
            "delta_ms": FRAME_DELTA_MS,
        },
        "samples": samples,
    })


@app.route("/video/<clip_id>/weights", methods=["POST"])
def video_weights(clip_id: str):
    """
    The depth-to-mass estimate across the clip, evenly spaced.

    For a Kinect depth recording (the colormap the depth station streams). A
    weights pass needs no detector and no frame pair, so one frame per sample
    is enough and the cap is higher than a sweep's. Only measurements come
    back: deciding what they mean is the API's and the operator's business, and
    like every other clip test nothing is persisted — a recording is not a
    reading.
    """
    clip, missing = _clip_or_404(clip_id)
    if missing:
        return missing

    try:
        count = int(request.args.get("count", weight.DEFAULT_SAMPLES))
    except (TypeError, ValueError):
        count = weight.DEFAULT_SAMPLES

    # delta 0: a weight sample is one frame, so there is no pair to leave
    # room for at the end of the clip.
    times = clip_store.sample_times(clip, count, 0, max_samples=weight.MAX_SAMPLES)
    deadline = time.monotonic() + VIDEO_SWEEP_BUDGET_S

    per_frame = []
    truncated = False
    decoded = depth_like = 0
    for t in times:
        if time.monotonic() > deadline:
            truncated = True
            break
        frame = clip_store.frame_at(clip, t)
        estimate = weight.estimate_weight_from_depth(frame)
        if estimate is None:
            per_frame.append({"t": t, "mass_g": None, "confidence": None, "warnings": ["video_frame_unavailable"]})
            continue
        decoded += 1
        depth_like += 1 if weight.looks_like_depth(frame) else 0
        per_frame.append({"t": t, **estimate})

    # The weight line prices any picture as grams, so a colour video of the pen would come back as a confident-looking number.
    # Refuse a clip whose frames are not a depth recording rather than answer it.
    if decoded and depth_like < decoded / 2:
        return jsonify({
            "error": "not_depth_recording",
            "detail": "This looks like an ordinary colour video, not a Kinect depth recording, so it cannot be weighed.",
        }), 422

    logger.info(
        "Weighed clip %s: %d of %d samples%s",
        clip.id, len(per_frame), len(times), " (budget reached)" if truncated else "",
    )

    return jsonify({
        "clip": clip.as_dict(),
        "sampling": {
            "requested": count,
            "taken": len(per_frame),
            "truncated": truncated,
        },
        "per_frame": per_frame,
        "summary": weight.summarize(per_frame),
    })


# ---------------------------------------------------------------------------
# Lifecycle
# ---------------------------------------------------------------------------

def _shutdown():
    """Clean up resources on exit."""
    logger.info("Shutting down vision service…")
    cameras.disconnect_all()


atexit.register(_shutdown)


# ---------------------------------------------------------------------------
# Camera link updates
# ---------------------------------------------------------------------------

def apply_camera_config() -> bool:
    """
    Point the camera manager at whatever Settings holds now.

    True when the link changed. The dict is edited in place because
    CameraManager holds this same object; its captures are then dropped so the
    next grab opens the new address instead of reading the old stream.
    """
    wanted = camera_config.read_sources()
    if wanted == _sources:
        return False

    if wanted:
        logger.info(
            "Camera link changed: %s",
            ", ".join(f"{cid} -> {camera_config.redact_url(url)}" for cid, url in wanted.items()),
        )
    else:
        logger.info("Camera link cleared: no camera configured any more")

    _sources.clear()
    _sources.update(wanted)
    cameras.disconnect_all()
    if _sources:
        cameras.connect_all()
    return True


# One watcher per process. The thread, not the request that started it, keeps
# the camera open, so a change in Settings is applied even while nobody asks
# for a frame.
_config_lock = threading.Lock()
_config_thread: threading.Thread | None = None


def ensure_camera_config_loop() -> None:
    """Start the camera-link watcher once, however this module was loaded."""
    global _config_thread
    with _config_lock:
        if _config_thread is not None and _config_thread.is_alive():
            return
        _config_thread = threading.Thread(
            target=camera_config_loop, daemon=True, name="camera-config"
        )
        _config_thread.start()
        logger.info(
            "Watching the camera link every %.0fs; configured cameras: %s",
            CONFIG_POLL_SECONDS,
            list(_sources.keys()) or "none",
        )


def camera_config_loop() -> None:
    """
    Re-read the camera link every few seconds, so a save in Settings applies.

    The first pass runs at once: this thread is what opens the camera when the
    service was started by gunicorn, and the analysis should not have to wait
    a poll before it has a picture. A camera left disconnected — off at boot,
    or a link that was wrong — is retried on every pass, so it comes back by
    itself once it can be reached again.
    """
    while True:
        try:
            if not apply_camera_config() and not any(
                cameras.is_connected(cid) for cid in _sources
            ):
                cameras.connect_all()
        except Exception:  # noqa: BLE001 - monitoring must not stop for this
            logger.exception("Could not refresh the camera link; keeping the current one")
        time.sleep(CONFIG_POLL_SECONDS)


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    logger.info(
        "Starting CereBroiler Vision Service on %s:%d",
        FLASK_HOST,
        FLASK_PORT,
    )
    # Settings can change the link later; this also makes the first connection.
    ensure_camera_config_loop()

    app.run(
        host=FLASK_HOST,
        port=FLASK_PORT,
        debug=False,
        threaded=True,
    )
