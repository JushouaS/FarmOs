"""
Depth-to-mass estimation for uploaded clips.

The live KINECT-01 station estimates a bird's mass from one depth-colormap
frame: the mean intensity of the frame's centre says how much of the platform
is covered by bird, and a fixed line turns that into grams (see
_analyze_kinect in cerebroil-stream). That estimate only ever ran live, so
there was no way to check the 3D weight pipeline against a recording the way
the behaviour pipeline can be checked with a clip.

This module is the same judgement, run over the frames of an uploaded depth
recording. The constants are deliberately identical to the live path — the
point of the test is to validate the same numbers the dashboard shows, not to
invent a better formula on the side.

The one honest improvement over the live path: a clip yields several frames,
so the spread and the median are real statistics across samples instead of
the single-frame stand-in the live path reports.
"""

import cv2
import numpy as np

#: The centre fraction of the frame the live path reads: 25%–75% in each axis.
ROI_FRACTION = 0.25

#: The live station's line: mass_g = K0 − K1 × mean_intensity.
K0 = 2400.0
K1 = 9.5

#: What the live path reports for a single-frame estimate. Carried over so a
#: clip sample and a live reading are comparable, spread included.
PER_FRAME_CONFIDENCE = 0.55

#: How many frames a weights pass samples by default, and the most it will.
#: Depth frames need no detector and no frame pair, so there is headroom for
#: more samples than a behaviour sweep takes — but a depth clip is usually
#: short and still, and sampling past the point where the median has settled
#: only spends time.
DEFAULT_SAMPLES = 12
MAX_SAMPLES = 60


#: A depth recording is either grey (the three channels agree) or the depth colormap the station streams (TURBO; JET
#: too). Ordinary colour footage is neither, and without this check the weight line turns *any* video into grams.
#: Measured on the project's own footage: ordinary colour frames are at least 77 grey levels (of 255) from the nearest colour
#: of either colormap, colormapped depth is within 10 even after video compression, and a grey frame's channels differ by 0 to 2
#: while a colour frame's differ by 17 or more (median over the sampled pixels). The limits sit well between.
GRAY_SPREAD = 6.0
COLORMAP_RESIDUAL = 40.0
_COLORMAPS = {
    name: cv2.applyColorMap(np.arange(256, dtype=np.uint8).reshape(256, 1), code).reshape(256, 3).astype(np.float32)
    for name, code in (("TURBO", cv2.COLORMAP_TURBO), ("JET", cv2.COLORMAP_JET))
}


def looks_like_depth(frame: np.ndarray | None) -> bool:
    """True when the frame is grey or drawn with a depth colormap, False for ordinary colour footage."""
    if frame is None:
        return False
    arr = np.asarray(frame)
    if arr.size == 0:
        return False
    if arr.ndim == 2 or arr.shape[2] == 1:
        return True
    pixels = arr[..., :3].reshape(-1, 3)
    pixels = pixels[:: max(1, len(pixels) // 4000)].astype(np.float32)
    if float(np.median(pixels.max(axis=1) - pixels.min(axis=1))) <= GRAY_SPREAD:
        return True
    for lut in _COLORMAPS.values():
        nearest = np.sqrt(((pixels[:, None, :] - lut[None, :, :]) ** 2).sum(axis=2)).min(axis=1)
        if float(np.median(nearest)) <= COLORMAP_RESIDUAL:
            return True
    return False


def estimate_weight_from_depth(frame: np.ndarray | None) -> dict | None:
    """
    One depth-colormap frame → one mass estimate, the way the live path does it.

    Returns None only when there is no frame to read. A frame that decodes is
    always answered, even when the answer is 0 g — an empty platform is a
    valid reading, not a failure.
    """
    if frame is None:
        return None

    arr = np.asarray(frame)
    if arr.size == 0:
        return None

    h, w = arr.shape[:2]
    top, bottom = int(h * ROI_FRACTION), int(h * (1.0 - ROI_FRACTION))
    left, right = int(w * ROI_FRACTION), int(w * (1.0 - ROI_FRACTION))
    roi = arr[top:bottom, left:right]
    if roi.size == 0:
        # A frame too small to hold the ROI. The live path cannot produce one;
        # a re-encoded clip might. Refuse rather than divide by zero pixels.
        return None

    if roi.ndim == 2:
        mean_intensity = float(np.mean(roi))
    else:
        mean_intensity = float(np.mean(cv2.cvtColor(roi, cv2.COLOR_BGR2GRAY)))

    mass_g = max(0.0, round(K0 - mean_intensity * K1, 1))
    return {"mass_g": mass_g, "confidence": PER_FRAME_CONFIDENCE}


def summarize(per_frame: list[dict]) -> dict:
    """
    The clip's headline: median, spread and range across the sampled frames.

    Frames that could not be read (mass_g is None) are left out rather than
    counted as 0 g — a missing sample is not an empty platform. `samples` says
    how many usable ones went into the numbers.
    """
    masses = [float(s["mass_g"]) for s in per_frame if s.get("mass_g") is not None]
    if not masses:
        return {
            "median_g": None,
            "std_dev_g": None,
            "min_g": None,
            "max_g": None,
            "samples": 0,
            "confidence": None,
        }

    std_dev = float(np.std(masses, ddof=1)) if len(masses) > 1 else 0.0
    confidences = [
        float(s["confidence"])
        for s in per_frame
        if s.get("mass_g") is not None and s.get("confidence") is not None
    ]
    return {
        "median_g": round(float(np.median(masses)), 1),
        "std_dev_g": round(std_dev, 1),
        "min_g": round(min(masses), 1),
        "max_g": round(max(masses), 1),
        "samples": len(masses),
        "confidence": (
            round(float(np.mean(confidences)), 2) if confidences else None
        ),
    }


# ---------------------------------------------------------------------------
# Weights from an ordinary colour picture (an overhead camera, not the Kinect)
# ---------------------------------------------------------------------------
#
# A rough guide, not a measurement. A bird's mass grows with its length cubed and its top-down area with its length squared,
# so mass is taken as proportional to (box area) ** 1.5. The proportionality has no scale of its own: the camera's distance
# and lens are unknown, so the numbers are calibrated by being told the flock's average weight (a scale reading, or the breed
# standard for the day), and every bird is weighed relative to the others. The average is therefore an input, never a result.
#
# Only birds the box describes well are weighed: a bird whose box overlaps another (two birds in one box, or one hidden behind
# another) or is cut by the edge of the picture has a size that says nothing about its weight, so it is shown but left out
# of the weighing and of the average used to calibrate.

#: A bird is not weighed when another box covers more than this share of the smaller of the two.
BIRD_OVERLAP_MAX = 0.10
#: ... or when its box comes this close to the edge of the picture (pixels).
BIRD_EDGE_MARGIN = 4
#: The calibration average must be a believable bird weight (grams).
MEAN_G_RANGE = (30.0, 8000.0)


def _overlap(a: tuple[float, float, float, float], b: tuple[float, float, float, float]) -> float:
    """The overlap of two (x, y, w, h) boxes as a share of the smaller one."""
    iw = min(a[0] + a[2], b[0] + b[2]) - max(a[0], b[0])
    ih = min(a[1] + a[3], b[1] + b[3]) - max(a[1], b[1])
    if iw <= 0 or ih <= 0:
        return 0.0
    return iw * ih / max(1e-9, min(a[2] * a[3], b[2] * b[3]))


#: Sizes are measured as if the picture were this big, so a clip re-encoded at another resolution gives the same size.
REFERENCE_FRAME = (1280, 720)


def size_unit(box: tuple[float, float, float, float], frame_size: tuple[int, int]) -> float:
    """A bird's size: its box area as it would be in a 1280x720 picture, to the power 1.5."""
    scale = (REFERENCE_FRAME[0] * REFERENCE_FRAME[1]) / float(frame_size[0] * frame_size[1])
    return (box[2] * box[3] * scale) ** 1.5


def size_weights(
    boxes: list[tuple[float, float, float, float]],
    frame_size: tuple[int, int],
    mean_g: float | None = None,
    grams_per_unit: float | None = None,
) -> dict:
    """
    One weight per box, from its size.

    boxes: (x, y, w, h) in pixels. frame_size: (width, height) of the picture. Give either `grams_per_unit` (the scale of this
    camera position, see size_calibration.json: the weights are then absolute and their average is a result) or `mean_g` (the
    weighed birds are scaled to average this: the average is an input).
    Returns {"birds": [{"weight_g": float | None, "reliable": bool, "reason": str | None}], "summary": {...}}.
    """
    width, height = frame_size
    birds = []
    for i, (x, y, w, h) in enumerate(boxes):
        reason = None
        if w <= 1 or h <= 1:
            reason = "too_small"
        elif x < BIRD_EDGE_MARGIN or y < BIRD_EDGE_MARGIN or x + w > width - BIRD_EDGE_MARGIN or y + h > height - BIRD_EDGE_MARGIN:
            reason = "cut_by_edge"
        elif any(j != i and _overlap(boxes[i], boxes[j]) > BIRD_OVERLAP_MAX for j in range(len(boxes))):
            reason = "overlaps_another_bird"
        birds.append({"weight_g": None, "reliable": reason is None, "reason": reason})

    units = {i: size_unit(boxes[i], frame_size) for i, b in enumerate(birds) if b["reliable"]}
    if units:
        if grams_per_unit is not None:
            factor = grams_per_unit
        elif mean_g is not None:
            factor = mean_g / float(np.mean(list(units.values())))
        else:
            raise ValueError("size_weights needs mean_g or grams_per_unit")
        for i, u in units.items():
            birds[i]["weight_g"] = round(factor * u, 1)

    weights = [b["weight_g"] for b in birds if b["weight_g"] is not None]
    summary = {
        "birds": len(birds),
        "weighed": len(weights),
        "mean_g": round(float(np.mean(weights)), 1) if weights else None,
        "median_g": round(float(np.median(weights)), 1) if weights else None,
        "min_g": min(weights) if weights else None,
        "max_g": max(weights) if weights else None,
        "spread_percent": round(float(np.std(weights) / np.mean(weights) * 100), 1) if len(weights) > 1 else None,
    }
    return {"birds": birds, "summary": summary}


# ---------------------------------------------------------------------------
# Which camera position is this? (the scale of a picture depends on it)
# ---------------------------------------------------------------------------

import base64  # noqa: E402
import json  # noqa: E402
import os  # noqa: E402

CALIBRATION_PATH = os.getenv("SIZE_CALIBRATION_PATH", os.path.join(os.path.dirname(os.path.abspath(__file__)), "size_calibration.json"))
SIGNATURE_SIZE = (96, 54)
#: A video is taken to come from a stored camera position when its background resembles that position's references at least this
#: much (a picture of something else scores about 0) and more than it resembles the other positions' references by MIN_MARGIN.
#: Measured by leaving each of the 15 recorded days out in turn: every day was matched to its own position, the closest call by
#: 0.04, the best scores between 0.28 and 0.55. A margin under CLEAR_MARGIN is reported as a close call.
MIN_SIMILARITY = 0.25
MIN_MARGIN = 0.03
CLEAR_MARGIN = 0.08


def background_signature(frames: list[np.ndarray]) -> np.ndarray:
    """
    The still part of the scene as a small picture (96 wide, 108 high): the median of the frames, so the moving birds drop out,
    as brightness in the top half and as colour strength (saturation) in the bottom half. Litter and lighting change from day to
    day; the pen's fixed things (walls, feeders, tarps) do not, and show in both.
    """
    small = [cv2.resize(f, (192, 108), interpolation=cv2.INTER_AREA) for f in frames]
    bg = np.median(np.stack(small), axis=0).astype(np.uint8)
    gray = cv2.cvtColor(bg, cv2.COLOR_BGR2GRAY)
    sat = cv2.cvtColor(bg, cv2.COLOR_BGR2HSV)[..., 1]
    halves = [cv2.GaussianBlur(cv2.resize(x, SIGNATURE_SIZE, interpolation=cv2.INTER_AREA), (3, 3), 0) for x in (gray, sat)]
    return np.vstack(halves)


def _correlation(a: np.ndarray, b: np.ndarray) -> float:
    x = a.astype(np.float32).ravel()
    y = b.astype(np.float32).ravel()
    x -= x.mean()
    y -= y.mean()
    denom = float(np.linalg.norm(x) * np.linalg.norm(y))
    return float(np.dot(x, y) / denom) if denom > 0 else 0.0


def similarity(a: np.ndarray, b: np.ndarray) -> float:
    """How alike two background signatures are, 1 = the same scene: the mean of the correlations of the two halves."""
    half = a.shape[0] // 2
    return (_correlation(a[:half], b[:half]) + _correlation(a[half:], b[half:])) / 2


_calibration_cache: dict | None = None


def load_calibration(path: str | None = None) -> dict | None:
    """size_calibration.json with its reference backgrounds decoded, or None when the file is missing or unreadable."""
    global _calibration_cache
    if path is None and _calibration_cache is not None:
        return _calibration_cache
    try:
        with open(path or CALIBRATION_PATH, encoding="utf-8") as fh:
            data = json.load(fh)
        for setup in data["setups"].values():
            setup["_refs"] = [
                cv2.imdecode(np.frombuffer(base64.b64decode(b), np.uint8), cv2.IMREAD_GRAYSCALE) for b in setup["backgrounds"]
            ]
    except (OSError, ValueError, KeyError):
        return None
    if path is None:
        _calibration_cache = data
    return data


def identify_setup(signature: np.ndarray, calibration: dict) -> tuple[str | None, float, float]:
    """(camera position, best similarity, runner-up similarity); the position is None when it is not clearly one of the stored ones."""
    scores = sorted(
        ((max(similarity(signature, ref) for ref in setup["_refs"]), name) for name, setup in calibration["setups"].items()),
        reverse=True,
    )
    best, name = scores[0]
    runner = scores[1][0] if len(scores) > 1 else -1.0
    if best >= MIN_SIMILARITY and best - runner >= MIN_MARGIN:
        return name, best, runner
    return None, best, runner


def draw_weights(frame: np.ndarray, boxes: list[tuple[float, float, float, float]], result: dict) -> np.ndarray:
    """The picture with each bird's box and its weight; birds that were not weighed are drawn grey with a dash."""
    out = frame.copy()
    for (x, y, w, h), bird in zip(boxes, result["birds"]):
        x, y, w, h = int(x), int(y), int(w), int(h)
        weighed = bird["weight_g"] is not None
        cv2.rectangle(out, (x, y), (x + w, y + h), (80, 220, 80) if weighed else (160, 160, 160), 2)
        label = f"{bird['weight_g']:.0f} g" if weighed else "-"
        (tw, th), _ = cv2.getTextSize(label, cv2.FONT_HERSHEY_SIMPLEX, 0.6, 2)
        top = max(0, y - th - 8)
        cv2.rectangle(out, (x, top), (x + tw + 6, top + th + 8), (0, 0, 0), -1)
        cv2.putText(out, label, (x + 3, top + th + 2), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255, 255, 255), 2)
    return out
