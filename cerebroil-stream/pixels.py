"""
pixels.py: how much of each bird's picture is unchanged since the previous picture.

Inactivity is judged the way the thesis' source (Kim 2022) does it: a bird has not moved when at least
95 % of the pixels inside its box are the same as in the previous picture taken by the camera
(behavior.STILL_PIXELS). This module measures that share; behavior.Engine decides what it means over time.

A pixel is "the same" when its grey value differs by no more than BEHAVIOR_PIXEL_TOLERANCE (default 20 of
255). The paper does not give this number: it has to be larger than the camera's noise (the picture is blurred
a little first, and a change in the brightness of the whole picture, such as the camera's exposure adjusting,
is subtracted) and smaller than a bird's own contrast against the floor. Check it on your own footage.
"""
from __future__ import annotations

import os

import cv2
import numpy as np

TOLERANCE = int(os.getenv("BEHAVIOR_PIXEL_TOLERANCE", "20"))
#: A box with fewer pixels than this has nothing to compare.
MIN_PIXELS = 64


def to_gray(frame: np.ndarray) -> np.ndarray:
    """A picture as the smoothed grey image the comparison is made on."""
    gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY) if frame.ndim == 3 else frame
    return cv2.GaussianBlur(gray, (5, 5), 0)


def unchanged_shares(prev: np.ndarray | None, gray: np.ndarray, boxes: list[list[float]]) -> list[float | None]:
    """For each box [x, y, w, h, ...] (x, y the top left corner), the share (0 to 1) of its pixels that are the same
    as at the same place in the previous picture. None for a box too small or outside the picture, and for every
    box when there is no previous picture or it has a different size."""
    if prev is None or prev.shape != gray.shape:
        return [None] * len(boxes)
    # What the whole picture changed by (exposure, lights), so only a change in the bird itself counts.
    diff = gray.astype(np.int16) - prev.astype(np.int16)
    diff = np.abs(diff - int(np.median(diff)))
    height, width = gray.shape[:2]
    shares: list[float | None] = []
    for box in boxes:
        x0, y0 = max(0, int(round(box[0]))), max(0, int(round(box[1])))
        x1, y1 = min(width, int(round(box[0] + box[2]))), min(height, int(round(box[1] + box[3])))
        region = diff[y0:y1, x0:x1]
        shares.append(None if region.size < MIN_PIXELS else float((region <= TOLERANCE).mean()))
    return shares
