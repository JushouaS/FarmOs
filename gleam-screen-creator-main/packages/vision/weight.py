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
