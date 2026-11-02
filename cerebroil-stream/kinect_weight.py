"""
kinect_weight.py: estimates a broiler's weight from its outline on the Kinect's colour picture and the depth picture.

How the numbers are made (this is how the training data was made, so it must stay the same):

1. The outline is drawn on the colour picture. The depth picture covers a narrower view than the colour one, so the
   outline is moved onto the depth picture by cutting the colour picture to the depth picture's shape (the full
   height, the middle part of the width) and shrinking that to the depth size. There is no exact colour-to-depth
   matching ("unregistered"); the training data was made the same way, so it stays consistent.
2. Five measurements are taken from the depth pixels under the outline:
     pixel_count          how many depth pixels the outline covers (in a 512x424 picture)
     projected_area_mm2   pixel_count x (middle depth / focal length)^2, the footprint on the floor
     length_mm, width_mm  2 x the spread of the pixels along the bird's long and short axis (millimetres)
     elongation           length / width
3. A small gradient-boosted model (models/weight_model_size_v1.json, made by train_weight_model.py) turns those five
   numbers into grams.

Accuracy: a single bird is typically off by about 18 % (about 175 g) because a footprint says only so much; the
average of many birds is much closer (about 2 %). See models/weight_model_size_v1.meta.json.
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import cv2
import numpy as np

DEPTH_W, DEPTH_H = 512, 424
# The focal length of the depth camera, in pixels of a 512-wide picture, that makes our footprint area agree with
# the training data (found by comparing 1,849 birds; the Kinect's own value is about 366).
FX_REF = 356.5
FEATURES = ["projected_area_mm2", "length_mm", "width_mm", "elongation", "pixel_count"]
MODEL_PATH = Path(__file__).parent / "models" / "weight_model_size_v1.json"
META_PATH = Path(__file__).parent / "models" / "weight_model_size_v1.meta.json"
MIN_PIXELS_512 = 150        # a smaller outline (in a 512-wide picture) is a scrap, not a bird
MIN_VALID_SHARE = 0.6       # at least this share of the pixels under an outline must have a depth reading


def mask_from_polygon(poly: list[list[float]], colour_w: int, colour_h: int, depth_w: int = DEPTH_W, depth_h: int = DEPTH_H) -> np.ndarray:
    """A mask on the depth grid for an outline given as [[x, y], ...] in 0..1 of the colour picture."""
    crop = (DEPTH_W / DEPTH_H) * (colour_h / colour_w)     # the share of the colour width that the depth picture sees
    left = (1 - crop) / 2
    pts = np.asarray(poly, dtype=np.float64)
    u = (pts[:, 0] - left) / crop * depth_w
    v = pts[:, 1] * depth_h
    mask = np.zeros((depth_h, depth_w), np.uint8)
    cv2.fillPoly(mask, [np.round(np.stack([u, v], 1)).astype(np.int32)], 1)
    return mask


def measure(depth_mm: np.ndarray, mask: np.ndarray) -> dict[str, float] | None:
    """The five measurements for one bird, or None when the depth under the outline is too poor to trust.

    depth_mm: depth in millimetres, 0 where there is no reading, any size (512x424, or half of it)."""
    h, w = depth_mm.shape
    fx = FX_REF * w / DEPTH_W
    ys, xs = np.nonzero(mask)
    n = len(xs)
    if n < MIN_PIXELS_512 * (w / DEPTH_W) ** 2:
        return None
    z = depth_mm[ys, xs].astype(np.float64)
    ok = z > 0
    if ok.mean() < MIN_VALID_SHARE:
        return None
    zmed = float(np.median(z[ok]))
    scale = (DEPTH_W / w) ** 2                  # pixels of a 512-wide picture per pixel here
    coords = np.stack([(xs[ok] - w / 2) * z[ok] / fx, (ys[ok] - h / 2) * z[ok] / fx], axis=1)
    eig = np.sort(np.linalg.eigvalsh(np.cov(coords.T)))[::-1]
    length, width = 2 * float(np.sqrt(max(eig[0], 0.0))), 2 * float(np.sqrt(max(eig[1], 1e-9)))
    return {
        "projected_area_mm2": n * (zmed / fx) ** 2,
        "length_mm": length,
        "width_mm": width,
        "elongation": length / width,
        "pixel_count": n * scale,
        "depth_mm": zmed,
    }


class WeightModel:
    """The trained model. `available` is False when the model file or xgboost is missing."""

    def __init__(self, path: Path = MODEL_PATH) -> None:
        self.available = False
        self.error: str | None = None
        self.meta: dict[str, Any] = {}
        self._booster = None
        try:
            import xgboost as xgb

            if not path.exists():
                raise FileNotFoundError(f"The weight model is not at {path}")
            self._xgb = xgb
            self._booster = xgb.Booster()
            self._booster.load_model(str(path))
            if META_PATH.exists() and path == MODEL_PATH:
                self.meta = json.loads(META_PATH.read_text(encoding="utf-8"))
            self.available = True
        except Exception as exc:  # noqa: BLE001 - a missing model or package must not stop the outlines
            self.error = str(exc)[:200]

    def predict(self, measurements: list[dict[str, float]]) -> list[float]:
        if not self.available or not measurements:
            return []
        rows = np.array([[m[f] for f in FEATURES] for m in measurements], dtype=np.float32)
        return [float(v) for v in self._booster.predict(self._xgb.DMatrix(rows, feature_names=None))]

    @property
    def typical_error_percent(self) -> float:
        """How far one bird's estimate is typically off, from the held-out test at training time."""
        return float(self.meta.get("unseen_birds", {}).get("mae_percent", 20.0))


def summarize(weights: list[float]) -> dict[str, Any] | None:
    """The flock's average, from the birds that have an estimate. Many birds average out most of the single-bird error."""
    if not weights:
        return None
    return {"n": len(weights), "meanG": round(float(np.mean(weights))), "medianG": round(float(np.median(weights)))}
