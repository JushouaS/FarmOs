"""Estimate broiler weights from Kinect RGB or registered RGB-D chicken masks."""
from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

import cv2
import numpy as np

DEPTH_W, DEPTH_H = 512, 424
COLOR_W, COLOR_H = 1920, 1080
# The focal length of the depth camera, in pixels of a 512-wide picture, that makes our footprint area agree with
# the training data (found by comparing 1,849 birds; the Kinect's own value is about 366).
FX_REF = 356.5
FEATURES = ["projected_area_mm2", "length_mm", "width_mm", "elongation", "pixel_count"]
MODEL_FEATURES = ["pixel_count", "elongation"]
RGBD_MODEL_FEATURES = [
    "projected_area_mm2", "volume_mm3", "length_mm", "width_mm",
    "max_height_mm", "mean_height_mm", "elongation", "height_std",
    "pixel_count", "pc_length_mm", "pc_width_mm", "pc_height_mm",
    "pc_volume_mm3", "pc_surface_area_mm2", "pc_normal_variance",
    "pc_point_count", "pc_point_density",
]
LEGACY_MODEL_PATH = Path(__file__).parent / "models" / "weight_model_coco_rgb_13sessions_hybrid_provisional.json"
MODEL_PATH = Path(os.getenv("KINECT_WEIGHT_MODEL", str(LEGACY_MODEL_PATH)))
META_PATH = Path(__file__).parent / "models" / "weight_model_coco_rgb_13sessions_hybrid_provisional.meta.json"
MIN_PIXELS_512 = 150        # a smaller outline (in a 512-wide picture) is a scrap, not a bird
MIN_VALID_SHARE = 0.6       # at least this share of the pixels under an outline must have a depth reading


def load_intrinsics(path: Path) -> dict[str, float]:
    """Load and validate the Kinect depth-camera intrinsics used for RGB-D features."""
    data = json.loads(path.read_text(encoding="utf-8"))
    intrinsics = {name: float(data[name]) for name in ("fx", "fy")}
    intrinsics["cx"] = float(data.get("cx", (DEPTH_W - 1) / 2))
    intrinsics["cy"] = float(data.get("cy", (DEPTH_H - 1) / 2))
    if not all(np.isfinite(value) for value in intrinsics.values()):
        raise ValueError(f"Intrinsics in {path} must be finite numbers.")
    if intrinsics["fx"] <= 0 or intrinsics["fy"] <= 0:
        raise ValueError(f"Intrinsics in {path} must have positive fx and fy.")
    return intrinsics


def clean_depth(depth_mm: np.ndarray, min_mm: float = 300, max_mm: float = 3000) -> np.ndarray:
    """Clip implausible depths and inpaint dropout holes as in RGB-D model training."""
    depth = depth_mm.astype(np.float32)
    invalid = (depth < min_mm) | (depth > max_mm) | (depth == 0)
    depth[invalid] = 0
    mask = (depth == 0).astype(np.uint8)
    if mask.sum() > 0:
        norm = cv2.normalize(depth, None, 0, 255, cv2.NORM_MINMAX).astype(np.uint8)
        filled = cv2.inpaint(norm, mask, inpaintRadius=3, flags=cv2.INPAINT_TELEA)
        valid_depth = depth[depth > 0]
        if valid_depth.size > 0:
            low, high = valid_depth.min(), valid_depth.max()
            filled_mm = low + (filled.astype(np.float32) / 255.0) * (high - low)
            depth = np.where(depth == 0, filled_mm, depth)
    return depth


def background_subtract(depth_mm: np.ndarray, floor_height_mm: float) -> np.ndarray:
    """Return height above the calibrated floor in millimetres."""
    return np.clip(floor_height_mm - depth_mm, 0, None)


def compute_rgbd_features(
    mask: np.ndarray,
    depth_mm: np.ndarray,
    height_map: np.ndarray,
    intrinsics: dict[str, float],
) -> dict[str, float] | None:
    """Compute the 17 ordered RGB-D model features using the training definitions."""
    ys, xs = np.where(mask > 0)
    if len(xs) < 20:
        return None

    depths = depth_mm[ys, xs]
    heights = height_map[ys, xs]
    pixel_areas = np.array([
        (depth / intrinsics["fx"]) * (depth / intrinsics["fy"])
        for depth in depths
    ])
    coords = np.stack([xs, ys], axis=1).astype(np.float32)
    coords -= coords.mean(axis=0)
    eigenvalues, _ = np.linalg.eigh(np.cov(coords.T))
    mean_depth = float(depths.mean())
    mm_per_pixel = mean_depth / ((intrinsics["fx"] + intrinsics["fy"]) / 2.0)
    length_mm = float(2 * np.sqrt(max(eigenvalues[-1], 0)) * mm_per_pixel)
    width_mm = float(2 * np.sqrt(max(eigenvalues[0], 0)) * mm_per_pixel)
    features: dict[str, float] = {
        "projected_area_mm2": float(pixel_areas.sum()),
        "volume_mm3": float(np.sum(pixel_areas * heights)),
        "length_mm": length_mm,
        "width_mm": width_mm,
        "max_height_mm": float(heights.max()),
        "mean_height_mm": float(heights.mean()),
        "elongation": length_mm / width_mm if width_mm > 1e-6 else 0.0,
        "height_std": float(heights.std()),
        "pixel_count": int(len(xs)),
    }

    z = depths.astype(np.float32)
    valid = z > 0
    x = (xs[valid].astype(np.float32) - intrinsics["cx"]) * z[valid] / intrinsics["fx"]
    y = (ys[valid].astype(np.float32) - intrinsics["cy"]) * z[valid] / intrinsics["fy"]
    points = np.stack([x, y, z[valid]], axis=1).astype(np.float32)
    point_features = compute_pointcloud_features(points)
    if point_features is None:
        return None
    features.update(point_features)
    if not all(np.isfinite(features[name]) for name in RGBD_MODEL_FEATURES):
        return None
    return features


def compute_pointcloud_features(
    points: np.ndarray,
    min_points: int = 30,
) -> dict[str, float] | None:
    """Compute the training pipeline's PCA, convex-hull, density and surface features."""
    from scipy.spatial import ConvexHull

    point_count = len(points)
    if point_count < min_points:
        return None

    centered = points - points.mean(axis=0)
    covariance = np.cov(centered.T)
    eigenvalues, eigenvectors = np.linalg.eigh(covariance)
    axes = eigenvectors[:, np.argsort(eigenvalues)[::-1]]
    projected = centered @ axes
    extents = np.sort(projected.max(axis=0) - projected.min(axis=0))[::-1]
    length_mm, width_mm, height_mm = (float(extent) for extent in extents)

    volume_mm3 = np.nan
    surface_area_mm2 = np.nan
    try:
        hull = ConvexHull(points)
        volume_mm3 = float(hull.volume)
        surface_area_mm2 = float(hull.area)
    except Exception:
        pass

    normal_variance = float(np.mean(estimate_surface_variation(points)))
    point_density = (
        float(point_count / volume_mm3)
        if volume_mm3 == volume_mm3 and volume_mm3 > 1e-6
        else np.nan
    )
    return {
        "pc_length_mm": length_mm,
        "pc_width_mm": width_mm,
        "pc_height_mm": height_mm,
        "pc_volume_mm3": volume_mm3,
        "pc_surface_area_mm2": surface_area_mm2,
        "pc_normal_variance": normal_variance,
        "pc_point_count": point_count,
        "pc_point_density": point_density,
    }


def estimate_surface_variation(points: np.ndarray, k: int = 16) -> np.ndarray:
    """Compute local PCA surface variation for each depth point."""
    from scipy.spatial import cKDTree

    point_count = len(points)
    neighbours_count = max(3, min(k, point_count))
    tree = cKDTree(points)
    _, indices = tree.query(points, k=neighbours_count)
    neighbours = points[indices]
    neighbours = neighbours - neighbours.mean(axis=1, keepdims=True)
    covariance = np.einsum("nki,nkj->nij", neighbours, neighbours) / neighbours_count
    eigenvalues = np.linalg.eigvalsh(covariance)
    total = eigenvalues.sum(axis=1)
    return np.where(total > 1e-9, eigenvalues[:, 0] / np.maximum(total, 1e-9), 0.0)


def register_color_mask_to_depth(
    color_mask: np.ndarray,
    depth_to_color: np.ndarray,
    color_shape: tuple[int, int],
) -> np.ndarray:
    """Sample a color-space segmentation mask at Kinect depth-to-color coordinates."""
    expected_shape = (DEPTH_H, DEPTH_W, 2)
    if color_mask.ndim != 2:
        raise ValueError("RGB segmentation mask must be a 2D array.")
    if depth_to_color.shape != expected_shape:
        raise ValueError(f"Depth-to-color map must have shape {expected_shape}, got {depth_to_color.shape}.")
    color_height, color_width = color_shape
    if color_height < 1 or color_width < 1:
        raise ValueError("RGB frame dimensions must be positive.")

    color_x = depth_to_color[..., 0]
    color_y = depth_to_color[..., 1]
    valid = (color_x != np.iinfo(np.uint16).max) & (color_y != np.iinfo(np.uint16).max)
    x = np.zeros(color_x.shape, dtype=np.intp)
    y = np.zeros(color_y.shape, dtype=np.intp)
    x[valid] = np.rint(color_x[valid].astype(np.float32) * color_width / COLOR_W).astype(np.intp)
    y[valid] = np.rint(color_y[valid].astype(np.float32) * color_height / COLOR_H).astype(np.intp)
    valid &= (x < color_width) & (y < color_height)

    registered_mask = np.zeros(depth_to_color.shape[:2], dtype=np.uint8)
    registered_mask[valid] = color_mask[y[valid], x[valid]] > 0
    return registered_mask


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


def measure_rgb_mask(mask: np.ndarray) -> dict[str, float] | None:
    """Return the provisional RGB model's mask area and image-space elongation."""
    w = mask.shape[1]
    ys, xs = np.nonzero(mask)
    if len(xs) < MIN_PIXELS_512 * (w / DEPTH_W) ** 2:
        return None

    coordinates = np.stack([xs, ys], axis=1)
    eigenvalues = np.linalg.eigvalsh(np.cov(coordinates.T))
    elongation = float(np.sqrt(max(eigenvalues[-1], 0.0) / max(eigenvalues[0], 1e-9)))
    return {
        "pixel_count": float(len(xs) * (DEPTH_W / w) ** 2),
        "elongation": elongation,
    }


class WeightModel:
    """Load a supported two-feature RGB or 17-feature RGB-D regression model."""

    def __init__(self, path: Path | None = None) -> None:
        self.available = False
        self.error: str | None = None
        self.meta: dict[str, Any] = {}
        self.feature_names = MODEL_FEATURES
        self.rgbd_mode = False
        self._booster = None
        try:
            import xgboost as xgb

            path = path or Path(os.getenv("KINECT_WEIGHT_MODEL", str(MODEL_PATH)))
            if not path.exists():
                raise FileNotFoundError(f"The weight model is not at {path}")
            self._xgb = xgb
            self._booster = xgb.Booster()
            self._booster.load_model(str(path))
            feature_count = self._booster.num_features()
            if feature_count == len(MODEL_FEATURES):
                self.feature_names = MODEL_FEATURES
            elif feature_count == len(RGBD_MODEL_FEATURES):
                self.feature_names = RGBD_MODEL_FEATURES
                self.rgbd_mode = True
            else:
                supported = f"{len(MODEL_FEATURES)} or {len(RGBD_MODEL_FEATURES)}"
                raise ValueError(f"Expected {supported} model features, got {feature_count}")
            meta_path = path.with_suffix(".meta.json")
            if path == LEGACY_MODEL_PATH and META_PATH.exists():
                meta_path = META_PATH
            if meta_path.exists():
                self.meta = json.loads(meta_path.read_text(encoding="utf-8"))
            self.available = True
        except Exception as exc:  # noqa: BLE001 - a missing model or package must not stop the outlines
            self.error = str(exc)[:200]

    def predict(self, measurements: list[dict[str, float]]) -> list[float]:
        if not self.available or not measurements:
            return []
        rows = np.array([[m[name] for name in self.feature_names] for m in measurements], dtype=np.float32)
        return [float(v) for v in self._booster.predict(self._xgb.DMatrix(rows, feature_names=None))]

    @property
    def typical_error_percent(self) -> float | None:
        """Held-out error when supplied with model metadata; otherwise it is unknown."""
        value = self.meta.get("unseen_birds", {}).get("mae_percent")
        return float(value) if isinstance(value, (int, float)) and np.isfinite(value) else None


def summarize(weights: list[float]) -> dict[str, Any] | None:
    """The flock's average, from the birds that have an estimate. Many birds average out most of the single-bird error."""
    if not weights:
        return None
    return {"n": len(weights), "meanG": round(float(np.mean(weights))), "medianG": round(float(np.median(weights)))}
