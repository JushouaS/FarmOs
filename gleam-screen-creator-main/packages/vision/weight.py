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
