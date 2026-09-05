"""
Computer-vision detection and analysis stub.

Provides a ``Detector`` class with methods for bird detection,
behaviour classification, and weight estimation.  The current
implementation returns realistic-looking placeholder data so the
rest of the pipeline can be developed end-to-end.

To integrate a real model (e.g. YOLOv8, Detectron2):
  1. Load the model in ``Detector.__init__``.
  2. Replace ``detect()`` internals with actual inference.
  3. Optionally override ``analyze_behaviour()`` and
     ``estimate_weight()`` with trained classifiers.
"""

import random
import time
from dataclasses import asdict, dataclass, field
from typing import Any

import numpy as np


# ---------------------------------------------------------------------------
# Data classes — mirror the PostgreSQL schema
# ---------------------------------------------------------------------------

@dataclass
class Detection:
    box_x: float
    box_y: float
    box_w: float
    box_h: float
    behavior: str
    estimated_weight_g: int | None
    weight_confidence: float | None
    flag: str | None

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass
class BehaviorSnapshot:
    movement_index: float
    movement_label: str
    movement_status: str
    huddling_risk: float
    huddling_label: str
    huddling_status: str
    aggression_events: int

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass
class ClusterWarning:
    label: str
    risk: float
    box: str  # JSON bbox, e.g. '{"x":100,"y":200,"w":300,"h":250}'

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass
class WeightEstimate:
    median_g: float
    std_dev_g: float
    sample_size: int
    confidence: float

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


# ---------------------------------------------------------------------------
# Detector
# ---------------------------------------------------------------------------

_BEHAVIOR_LABELS = ["walking", "resting", "feeding", "drinking", "huddling", "dust-bathing"]
_MOVEMENT_LABELS = ["normal", "elevated", "low", "resting"]
_MOVEMENT_STATUSES = ["nominal", "warning", "deviation"]
_HUDDLING_LABELS = ["none", "mild", "moderate", "severe"]
_HUDDLING_STATUSES = ["nominal", "warning", "critical"]


class Detector:
    """Placeholder CV detector — swap internals for a real model."""

    def __init__(self) -> None:
        # Placeholder: in production, load your model here.
        # e.g. self.model = YOLO("best.pt")
        self._rng = random.Random(42)
        self._frame_count = 0

    # ------------------------------------------------------------------
    # Detection
    # ------------------------------------------------------------------

    def detect(self, frame: np.ndarray) -> list[Detection]:
        """
        Run object detection on a BGR frame.

        Returns a list of ``Detection`` objects with bounding boxes,
        behaviour labels, and optional weight estimates.

        **Current implementation:** generates 5-15 random detections
        distributed across the frame dimensions.
        """
        h, w = frame.shape[:2]
        self._frame_count += 1
        count = self._rng.randint(5, 15)
        detections: list[Detection] = []

        for _ in range(count):
            bx = self._rng.uniform(0.05 * w, 0.75 * w)
            by = self._rng.uniform(0.10 * h, 0.70 * h)
            bw = self._rng.uniform(0.04 * w, 0.12 * w)
            bh = self._rng.uniform(0.05 * h, 0.15 * h)
            behavior = self._rng.choice(_BEHAVIOR_LABELS)

            # Weight estimate only for ~60 % of detections
            if self._rng.random() < 0.6:
                weight_g = int(self._rng.gauss(2450, 180))
                weight_conf = round(self._rng.uniform(0.70, 0.95), 2)
            else:
                weight_g = None
                weight_conf = None

            flag = None
            if behavior == "huddling" and self._rng.random() < 0.3:
                flag = "cluster"

            detections.append(Detection(
                box_x=round(bx, 1),
                box_y=round(by, 1),
                box_w=round(bw, 1),
                box_h=round(bh, 1),
                behavior=behavior,
                estimated_weight_g=weight_g,
                weight_confidence=weight_conf,
                flag=flag,
            ))

        return detections

    # ------------------------------------------------------------------
    # Behaviour analysis
    # ------------------------------------------------------------------

    def analyze_behaviour(self, detections: list[Detection]) -> BehaviorSnapshot:
        """
        Derive a behaviour snapshot from a set of detections.

        **Current implementation:** synthesises plausible metrics
        based on the distribution of behaviour labels.
        """
        n = max(len(detections), 1)
        huddling_count = sum(1 for d in detections if d.behavior == "huddling")
        huddling_ratio = huddling_count / n

        movement_index = round(self._rng.uniform(0.3, 0.9), 2)
        movement_label = self._rng.choice(_MOVEMENT_LABELS)
        movement_status = self._rng.choice(_MOVEMENT_STATUSES)

        huddling_risk = round(min(huddling_ratio * 3 + self._rng.uniform(0, 0.15), 1.0), 2)
        if huddling_risk < 0.25:
            huddling_label = "none"
            huddling_status = "nominal"
        elif huddling_risk < 0.6:
            huddling_label = self._rng.choice(["mild", "moderate"])
            huddling_status = "warning"
        else:
            huddling_label = "severe"
            huddling_status = "critical"

        aggression_events = self._rng.randint(0, 3) if movement_label == "elevated" else 0

        return BehaviorSnapshot(
            movement_index=movement_index,
            movement_label=movement_label,
            movement_status=movement_status,
            huddling_risk=huddling_risk,
            huddling_label=huddling_label,
            huddling_status=huddling_status,
            aggression_events=aggression_events,
        )

    # ------------------------------------------------------------------
    # Weight estimation
    # ------------------------------------------------------------------

    def estimate_weight(self, detections: list[Detection]) -> WeightEstimate | None:
        """
        Aggregate weight estimates from detections that carry weight data.

        **Current implementation:** uses the per-detection estimates
        with a small amount of added noise.
        """
        weights = [
            d.estimated_weight_g
            for d in detections
            if d.estimated_weight_g is not None
        ]
        if not weights:
            return None

        arr = np.array(weights, dtype=float)
        median = float(np.median(arr)) + self._rng.gauss(0, 15)
        std = float(np.std(arr)) + self._rng.gauss(0, 5)
        avg_conf = float(np.mean([
            d.weight_confidence for d in detections
            if d.weight_confidence is not None
        ])) if any(d.weight_confidence is not None for d in detections) else 0.8

        return WeightEstimate(
            median_g=round(median, 1),
            std_dev_g=round(abs(std), 1),
            sample_size=len(weights),
            confidence=round(min(avg_conf, 1.0), 2),
        )

    # ------------------------------------------------------------------
    # Cluster detection
    # ------------------------------------------------------------------

    def detect_clusters(self, detections: list[Detection]) -> list[ClusterWarning]:
        """
        Identify spatial clusters that may indicate huddling behaviour.

        **Current implementation:** flags groups of ≥3 detections
        labelled 'huddling' that are spatially close.
        """
        huddlers = [d for d in detections if d.behavior == "huddling"]
        if len(huddlers) < 3:
            return []

        # Simple: treat all huddlers as one cluster
        min_x = min(d.box_x for d in huddlers)
        min_y = min(d.box_y for d in huddlers)
        max_x = max(d.box_x + d.box_w for d in huddlers)
        max_y = max(d.box_y + d.box_h for d in huddlers)

        risk = round(min(len(huddlers) * 0.12 + self._rng.uniform(0, 0.1), 1.0), 2)

        import json
        box = json.dumps({
            "x": round(min_x, 1),
            "y": round(min_y, 1),
            "w": round(max_x - min_x, 1),
            "h": round(max_y - min_y, 1),
        })

        return [ClusterWarning(
            label=f"huddling_cluster_{len(huddlers)}birds",
            risk=risk,
            box=box,
        )]
