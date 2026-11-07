"""
Bird detection (ONNX) plus the per-frame measurements behind the behaviour
labels.

This module answers "where are the birds, and which of them moved"; deciding
what those numbers *mean* (is this huddling, is it night) happens in the API.
Splitting it that way keeps the policy in one place — the TypeScript side — so
the thresholds are not quietly duplicated between here and there.

Configuration is by environment variable, because the model is not in the
repository and the operator supplies it:

  CHICKEN_MODEL_PATH    default models/chicken.onnx (relative to /app)
  CHICKEN_INPUT_SIZE    default 640 — overridden by the graph's own input shape
  CHICKEN_CLASSES       comma-separated class names, in the model's own order
                        (default "chicken")
  CHICKEN_CONF_MIN      default 0.35
  CHICKEN_NMS_IOU       default 0.45
  CHICKEN_MODEL_HAS_NMS "true" when the graph already applies NMS and returns
                        [x1, y1, x2, y2, score, class] rows
  CHICKEN_ZONE_ANCHOR   "centre" (overhead camera) or "foot" (angled camera)

With no model file present the service still starts and still serves the live
feed; it reports that detection is unavailable instead of inventing birds.
"""

import logging
import os
from dataclasses import dataclass, field

import cv2
import numpy as np

import behavior as bz
import zones as zone_store

logger = logging.getLogger(__name__)

MODEL_PATH = os.getenv("CHICKEN_MODEL_PATH", "models/chicken.onnx")
INPUT_SIZE = int(os.getenv("CHICKEN_INPUT_SIZE", "640"))
CLASSES = [c.strip() for c in os.getenv("CHICKEN_CLASSES", "chicken").split(",") if c.strip()]
CONF_MIN = float(os.getenv("CHICKEN_CONF_MIN", "0.35"))
NMS_IOU = float(os.getenv("CHICKEN_NMS_IOU", "0.45"))
MODEL_HAS_NMS = os.getenv("CHICKEN_MODEL_HAS_NMS", "false").lower() in ("1", "true", "yes")
ZONE_ANCHOR = os.getenv("CHICKEN_ZONE_ANCHOR", "centre")

#: A frame-to-frame shift bigger than this is the camera moving, not the
#: flock — most likely a gust of wind or a zoom reset. Correcting it would
#: smear the picture, so the sample is reported as unreliable instead.
MAX_SHIFT_PX = float(os.getenv("VISION_MAX_SHIFT_PX", "6"))

#: Below this mean brightness the diff mostly measures sensor noise.
MIN_LUMA = float(os.getenv("VISION_MIN_LUMA", "18"))


@dataclass
class Detection:
    """One bird, in source-frame pixels."""

    box_x: float
    box_y: float
    box_w: float
    box_h: float
    confidence: float
    behavior: str = "unknown"
    motion: float = 0.0
    zone: str | None = None
    estimated_weight_g: float | None = None
    weight_confidence: float | None = None
    flag: str | None = None

    def as_dict(self) -> dict:
        return {
            "box_x": round(self.box_x, 2),
            "box_y": round(self.box_y, 2),
            "box_w": round(self.box_w, 2),
            "box_h": round(self.box_h, 2),
            "confidence": round(self.confidence, 4),
            "behavior": self.behavior,
            "motion": round(self.motion, 5),
            "zone": self.zone,
            "estimated_weight_g": self.estimated_weight_g,
            "weight_confidence": self.weight_confidence,
            "flag": self.flag,
        }


@dataclass
class Analysis:
    detections: list[Detection] = field(default_factory=list)
    metrics: dict = field(default_factory=dict)
    clusters: list[dict] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)


# ---------------------------------------------------------------------------
# Post-processing helpers
# ---------------------------------------------------------------------------

def _letterbox(frame: np.ndarray, size: int):
    """
    Resize keeping the aspect ratio and pad to a square, the way the model was
    trained. Returns the padded image plus what is needed to map boxes back.
    """
    h, w = frame.shape[:2]
    ratio = min(size / w, size / h)
    new_w, new_h = int(round(w * ratio)), int(round(h * ratio))
    pad_w, pad_h = (size - new_w) / 2, (size - new_h) / 2

    resized = cv2.resize(frame, (new_w, new_h), interpolation=cv2.INTER_LINEAR)
    top, bottom = int(round(pad_h - 0.1)), int(round(pad_h + 0.1))
    left, right = int(round(pad_w - 0.1)), int(round(pad_w + 0.1))
    padded = cv2.copyMakeBorder(
        resized, top, bottom, left, right, cv2.BORDER_CONSTANT, value=(114, 114, 114)
    )
    return padded, ratio, left, top


def _nms(boxes: np.ndarray, scores: np.ndarray, iou_threshold: float) -> list[int]:
    """Plain greedy non-maximum suppression over xyxy boxes."""
    if len(boxes) == 0:
        return []

    x1, y1, x2, y2 = boxes[:, 0], boxes[:, 1], boxes[:, 2], boxes[:, 3]
    areas = np.maximum(0.0, x2 - x1) * np.maximum(0.0, y2 - y1)
    order = scores.argsort()[::-1]

    keep: list[int] = []
    while order.size > 0:
        i = int(order[0])
        keep.append(i)
        if order.size == 1:
            break
        rest = order[1:]
        inter_w = np.maximum(0.0, np.minimum(x2[i], x2[rest]) - np.maximum(x1[i], x1[rest]))
        inter_h = np.maximum(0.0, np.minimum(y2[i], y2[rest]) - np.maximum(y1[i], y1[rest]))
        inter = inter_w * inter_h
        union = areas[i] + areas[rest] - inter
        iou = np.where(union > 0, inter / np.maximum(union, 1e-9), 0.0)
        order = rest[iou <= iou_threshold]
    return keep


def _as_abox(output: np.ndarray) -> np.ndarray:
    """Normalise the three common YOLO/ONNX result layouts to (N, C)."""
    arr = np.asarray(output, dtype=np.float32)
    if arr.ndim == 3:
        arr = arr[0]
    if arr.ndim != 2:
        return np.empty((0, 0), dtype=np.float32)
    # (C, N) with far fewer boxes than columns? Transpose. YOLOv8 export gives
    # (4 + classes, candidates), YOLOv5 gives (candidates, 5 + classes).
    if arr.shape[0] < arr.shape[1]:
        arr = arr.T
    return arr


# ---------------------------------------------------------------------------
# Detector
# ---------------------------------------------------------------------------

class Detector:
    """Loads the ONNX graph once and reuses it for every frame."""

    def __init__(self) -> None:
        self.session = None
        self.input_name = ""
        self.input_size = INPUT_SIZE
        self.load_error: str | None = None
        self._load()

    @property
    def available(self) -> bool:
        return self.session is not None

    def _load(self) -> None:
        if not os.path.exists(MODEL_PATH):
            self.load_error = f"no model at {MODEL_PATH}"
            logger.warning(
                "Detection disabled: %s. Drop the .onnx export there or set "
                "CHICKEN_MODEL_PATH. The live feed and zone editor still work.",
                self.load_error,
            )
            return

        try:
            import onnxruntime as ort  # imported lazily so a missing wheel is not a crash

            # One thread per worker is plenty here: inference runs about once a
            # minute, so competing for cores would only slow the video.
            options = ort.SessionOptions()
            options.intra_op_num_threads = 2
            self.session = ort.InferenceSession(
                MODEL_PATH, sess_options=options, providers=["CPUExecutionProvider"]
            )
            model_input = self.session.get_inputs()[0]
            self.input_name = model_input.name
            shape = model_input.shape
            # Shape is [batch, channels, h, w]; anything symbolic keeps the default.
            if len(shape) == 4 and isinstance(shape[2], int) and shape[2] > 0:
                self.input_size = int(shape[2])
            logger.info(
                "Loaded %s (input %dx%d, classes=%s)",
                MODEL_PATH, self.input_size, self.input_size, CLASSES,
            )
        except ImportError:
            self.load_error = "onnxruntime is not installed"
            logger.error("Detection disabled: %s", self.load_error)
        except Exception as exc:  # noqa: BLE001 - a bad model must not stop the service
            self.load_error = f"could not load model: {exc}"
            logger.exception("Detection disabled: %s", self.load_error)
            self.session = None

    # -- inference ---------------------------------------------------------

    def detect(
        self,
        frame: np.ndarray,
        conf_min: float | None = None,
        nms_iou: float | None = None,
    ) -> list[Detection]:
        """Run the graph on one frame and return bird boxes in frame pixels.

        conf_min and nms_iou default to CHICKEN_CONF_MIN and CHICKEN_NMS_IOU.
        The clip tracker passes its own (0.1 and 0.7, what Ultralytics uses for
        klydel's runs): ByteTrack needs the weak boxes the live reading drops."""
        if self.session is None or frame is None or frame.size == 0:
            return []

        padded, ratio, pad_x, pad_y = _letterbox(frame, self.input_size)
        blob = padded[:, :, ::-1].astype(np.float32) / 255.0  # BGR -> RGB
        blob = np.ascontiguousarray(blob.transpose(2, 0, 1)[None, ...])

        try:
            outputs = self.session.run(None, {self.input_name: blob})
        except Exception as exc:  # noqa: BLE001
            logger.warning("Inference failed: %s", exc)
            return []

        rows = _as_abox(outputs[0])
        if rows.size == 0:
            return []

        boxes_xyxy, scores, class_ids = self._decode(rows, CONF_MIN if conf_min is None else conf_min)
        if len(scores) == 0:
            return []

        keep = _nms(boxes_xyxy, scores, NMS_IOU if nms_iou is None else nms_iou)

        frame_h, frame_w = frame.shape[:2]
        detections: list[Detection] = []
        for i in keep:
            x1, y1, x2, y2 = boxes_xyxy[i]
            # Undo the letterbox, then clamp to the frame.
            x1 = (x1 - pad_x) / ratio
            y1 = (y1 - pad_y) / ratio
            x2 = (x2 - pad_x) / ratio
            y2 = (y2 - pad_y) / ratio
            x1, x2 = max(0.0, min(x1, frame_w - 1)), max(0.0, min(x2, frame_w - 1))
            y1, y2 = max(0.0, min(y1, frame_h - 1)), max(0.0, min(y2, frame_h - 1))
            w, h = x2 - x1, y2 - y1
            if w < 4 or h < 4:
                continue
            detections.append(
                Detection(
                    box_x=float(x1),
                    box_y=float(y1),
                    box_w=float(w),
                    box_h=float(h),
                    confidence=float(scores[i]),
                )
            )
        return detections

    def _decode(self, rows: np.ndarray, conf_min: float | None = None):
        """
        Split a result matrix into clean xyxy boxes, scores and class indices.

        Three layouts turn up in practice and the column count tells them
        apart: NMS baked in (6 columns: x1 y1 x2 y2 score class), YOLOv8
        (4 + classes, no objectness) and YOLOv5 (5 + classes, objectness in
        column 4).
        """
        columns = rows.shape[1]

        if MODEL_HAS_NMS and columns == 6:
            boxes = rows[:, :4].copy()
            scores = rows[:, 4]
            class_ids = rows[:, 5].astype(int)
            return self._filter(boxes, scores, class_ids, conf_min)

        # 4 box values plus at least one class score. A single-class export is
        # only 5 columns wide, which is the common case here.
        if columns < 5:
            return np.empty((0, 4)), np.empty(0), np.empty(0, dtype=int)

        # YOLOv8 dropped the objectness score YOLOv5 keeps in column 4, and a
        # one-class v5 model and a two-class v8 model are both 6 columns wide.
        # The operator's class list is what tells them apart; only when it does
        # not line up do we fall back to guessing from the score magnitudes.
        if columns == 5 or len(CLASSES) == columns - 4:
            has_objectness = False
        elif len(CLASSES) == columns - 5:
            has_objectness = True
        else:
            has_objectness = rows[:, 4].max() > rows[:, 5:].max()

        boxes = self._cxcywh_to_xyxy(rows[:, :4])
        if has_objectness:
            prob = rows[:, 4:5] * rows[:, 5:]
        else:
            prob = rows[:, 4:]

        return self._filter(boxes, prob.max(axis=1), prob.argmax(axis=1), conf_min)

    def _filter(self, boxes, scores, class_ids, conf_min: float | None = None):
        """Keep confident boxes whose class is one we were told to look for."""
        scores = np.asarray(scores, dtype=np.float32).reshape(-1)
        class_ids = np.asarray(class_ids).reshape(-1).astype(int)
        mask = scores >= (CONF_MIN if conf_min is None else conf_min)

        # Class filtering only makes sense when the operator's list is the same
        # length as the model's class count. A mismatch means indices cannot be
        # mapped to names, so keep everything rather than silently discarding
        # birds — over-reporting is recoverable, missing a sick bird is not.
        if len(CLASSES) > 1 and scores.size:
            mask &= np.isin(class_ids, list(range(len(CLASSES))))

        return (
            np.asarray(boxes, dtype=np.float32)[mask],
            scores[mask],
            class_ids[mask],
        )

    @staticmethod
    def _cxcywh_to_xyxy(boxes: np.ndarray) -> np.ndarray:
        cx, cy, w, h = boxes[:, 0], boxes[:, 1], boxes[:, 2], boxes[:, 3]
        return np.stack([cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2], axis=1)


# ---------------------------------------------------------------------------
# Frame pair -> measurements
# ---------------------------------------------------------------------------

def estimate_shift(prev_gray: np.ndarray, now_gray: np.ndarray) -> tuple[float, float]:
    """
    How far the whole picture moved between the two frames, in pixels.

    Cameras on a bracket still sway in the wind. Left uncorrected, that sway
    moves every box's pixels and makes the entire flock look active.
    """
    try:
        shift, _response = cv2.phaseCorrelate(
            np.float32(prev_gray), np.float32(now_gray)
        )
        return float(shift[0]), float(shift[1])
    except cv2.error:
        return 0.0, 0.0


def _align(prev_bgr: np.ndarray, dx: float, dy: float) -> np.ndarray:
    matrix = np.float32([[1, 0, dx], [0, 1, dy]])
    h, w = prev_bgr.shape[:2]
    return cv2.warpAffine(
        prev_bgr, matrix, (w, h), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE
    )


def analyse_pair(
    camera_id: str,
    prev_bgr: np.ndarray,
    now_bgr: np.ndarray,
    detector: Detector,
    zones: list | None = None,
) -> Analysis:
    """
    Measure one frame pair: who is there, who moved, who is packed together.

    Inactivity is judged over every bird. Huddling is judged over the birds
    that are *not* standing in a marked feeder zone, because a crowd at a
    feeder is feeding.

    `zones` is for footage that is not a camera: a clip has no row to look up,
    so the caller passes the polygons to test against. None means "whatever the
    camera has saved", which is the live path.
    """
    if prev_bgr is None or now_bgr is None:
        return Analysis(metrics=_empty_metrics(), warnings=["no_frame"])

    frame_h, frame_w = now_bgr.shape[:2]
    now_gray = cv2.cvtColor(now_bgr, cv2.COLOR_BGR2GRAY)
    prev_gray = cv2.cvtColor(prev_bgr, cv2.COLOR_BGR2GRAY)
    mean_luma = float(now_gray.mean())

    warnings: list[str] = []
    if not detector.available:
        warnings.append("model_unavailable")
        metrics = _empty_metrics()
        metrics.update({"resolution": [frame_w, frame_h], "mean_luma": round(mean_luma, 1)})
        return Analysis(metrics=metrics, warnings=warnings)

    detections = detector.detect(now_bgr)
    if not detections:
        metrics = _empty_metrics()
        metrics.update({"resolution": [frame_w, frame_h], "mean_luma": round(mean_luma, 1)})
        if mean_luma < MIN_LUMA:
            warnings.append("too_dark")
        else:
            warnings.append("no_birds")
        return Analysis(metrics=metrics, warnings=warnings)

    dx, dy = estimate_shift(prev_gray, now_gray)
    shift = float(np.hypot(dx, dy))
    aligned_prev = _align(prev_bgr, dx, dy) if shift <= MAX_SHIFT_PX else prev_bgr
    if shift > MAX_SHIFT_PX:
        warnings.append("camera_moved")
    if mean_luma < MIN_LUMA:
        warnings.append("too_dark")

    prev_aligned_gray = cv2.cvtColor(aligned_prev, cv2.COLOR_BGR2GRAY)

    boxes = [bz.Box(d.box_x, d.box_y, d.box_w, d.box_h, d.confidence) for d in detections]
    motions = bz.box_motions(prev_aligned_gray, now_gray, boxes)

    polygons = zone_store.get_zones(camera_id) if zones is None else zones
    in_zone = bz.zone_mask(boxes, polygons, frame_w, frame_h, ZONE_ANCHOR)

    inactive_count = 0
    for det, motion, zoned in zip(detections, motions, in_zone):
        det.motion = motion
        det.zone = "feeder" if zoned else None
        # A bird inside a feeder zone that is not moving is feeding, not
        # inactive — same pixels, different meaning.
        if motion < bz.MOTION_THRESHOLD:
            det.behavior = "feeding" if zoned else "inactive"
        else:
            det.behavior = "active"
    inactive_count = bz.count_inactive(motions)

    # Huddling only looks at birds outside the feeder/drinker zones.
    evaluable = [b for b, zoned in zip(boxes, in_zone) if not zoned]
    huddle = bz.cluster_huddling(evaluable) if len(evaluable) >= bz.MIN_CLUSTER else bz.HuddleResult()
    detections = _mark_huddled(detections, in_zone, huddle)

    huddled_count = sum(huddle.huddled)

    metrics = {
        "bird_count": len(detections),
        "zone_count": sum(in_zone),
        "evaluable_count": len(evaluable),
        "inactive_count": inactive_count,
        "huddled_count": huddled_count,
        "movement_index": round(float(np.mean(motions)) if motions else 0.0, 5),
        "huddling_risk": huddle.risk,
        "huddling_coverage": huddle.coverage,
        "huddling_compactness": huddle.compactness,
        "huddle_radius_px": huddle.radius,
        "confidence": round(float(np.mean([d.confidence for d in detections])), 4),
        "resolution": [frame_w, frame_h],
        "mean_luma": round(mean_luma, 1),
        "global_shift": round(shift, 2),
        "zones": len(polygons),
        "model_loaded": True,
    }
    return Analysis(
        detections=detections,
        metrics=metrics,
        clusters=_cluster_boxes(evaluable, huddle),
        warnings=warnings,
    )


def _cluster_boxes(boxes: list[bz.Box], huddle: bz.HuddleResult) -> list[dict]:
    """One entry per huddle, for the cluster_warnings table and the dashboard."""
    out: list[dict] = []
    for members in huddle.clusters:
        xs = [boxes[i].x for i in members]
        ys = [boxes[i].y for i in members]
        xe = [boxes[i].x + boxes[i].w for i in members]
        ye = [boxes[i].y + boxes[i].h for i in members]
        x, y = min(xs), min(ys)
        out.append({
            "label": f"Huddle of {len(members)}",
            "risk": huddle.risk,
            "box": {"x": round(x, 1), "y": round(y, 1),
                    "w": round(max(xe) - x, 1), "h": round(max(ye) - y, 1)},
        })
    return out


def _mark_huddled(detections: list[Detection], in_zone: list[bool], huddle: bz.HuddleResult) -> list[Detection]:
    """Flag the huddled birds, keeping evaluable-bird indices aligned."""
    huddle_iter = iter(huddle.huddled)
    for det, zoned in zip(detections, in_zone):
        if zoned:
            continue
        if next(huddle_iter, False):
            det.flag = "huddled"
    return detections


def _empty_metrics() -> dict:
    return {
        "bird_count": 0,
        "zone_count": 0,
        "evaluable_count": 0,
        "inactive_count": 0,
        "huddled_count": 0,
        "movement_index": 0.0,
        "huddling_risk": 0.0,
        "huddling_coverage": 0.0,
        "huddling_compactness": 0.0,
        "huddle_radius_px": 0.0,
        "confidence": 0.0,
        "resolution": [0, 0],
        "mean_luma": 0.0,
        "global_shift": 0.0,
        "zones": 0,
        "model_loaded": False,
    }
