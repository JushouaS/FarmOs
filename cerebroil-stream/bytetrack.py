"""
bytetrack.py: follows each bird from one picture to the next with the ByteTrack method (Zhang et al., 2022).

What ByteTrack does, and what is kept here:
  - Every followed bird has a Kalman filter (constant velocity on centre x, centre y, aspect ratio, height) that predicts
    where the bird should be in the next picture.
  - First association: the confident detections (score >= HIGH_SCORE) are matched to all followed birds, the lost ones
    included, by overlap with the predicted box (cost 1 - IoU x score, accepted up to MATCH_THRESH) with the Hungarian algorithm.
  - Second association, the idea that gives the method its name: the weak detections (score below HIGH_SCORE) are matched to
    the birds that are still unmatched and were seen in the previous picture (accepted up to LOW_MATCH_THRESH). A bird whose
    score dips for a moment (turned away, half hidden) keeps its number instead of being dropped and renamed.
  - A bird that finds no detection is kept as "lost" for a while (behavior.py decides how long) and keeps its number if it
    comes back.

Two adaptations, because this runs on pictures taken every few seconds, not on video:
  - A third pass pairs the birds and detections still left by distance (within one body size), because at a few seconds between
    pictures a walking bird no longer overlaps its predicted box at all.
  - Every detection that matches nothing starts a bird, not only the confident ones: each box the page draws must carry a number.
    ByteTrack would discard a weak unmatched box as background; here the detector's own confidence floor (DETECTOR_CONFIDENCE,
    0.25) already did that.

Pure Python, no libraries: it has to run on the Raspberry Pi next to the detector and be testable without it. The Kalman filter
is the 8-state ByteTrack filter written as four independent two-state filters, which is exactly equivalent because its
covariances are diagonal blocks.
"""
from __future__ import annotations

import math
import os
from typing import Any

#: A detection with at least this score is "confident" (first association). ByteTrack's default is 0.5.
HIGH_SCORE = float(os.getenv("BEHAVIOR_TRACK_HIGH", "0.5"))
#: Largest cost (1 - IoU x score) accepted in the first and in the second association (ByteTrack's 0.8 and 0.5).
MATCH_THRESH = 0.8
LOW_MATCH_THRESH = 0.5

_POS_W = 1.0 / 20       # ByteTrack's noise weights, relative to the box height
_VEL_W = 1.0 / 160


class BoxKalman:
    """Constant-velocity Kalman filter for one box: state centre x, centre y, aspect ratio (w/h) and height, each with a velocity."""

    def __init__(self, cx: float, cy: float, w: float, h: float) -> None:
        h = max(h, 1e-6)
        self.p = [cx, cy, w / h, h]
        self.v = [0.0, 0.0, 0.0, 0.0]
        sp = [2 * _POS_W * h, 2 * _POS_W * h, 1e-2, 2 * _POS_W * h]
        sv = [10 * _VEL_W * h, 10 * _VEL_W * h, 1e-5, 10 * _VEL_W * h]
        # per coordinate: [variance of position, covariance, variance of velocity]
        self.P = [[a * a, 0.0, b * b] for a, b in zip(sp, sv)]

    def predict(self, dt: float) -> None:
        """Moves the box on by dt pictures (pictures, not seconds: 1.0 is the usual gap)."""
        h = self.p[3]
        qp = [_POS_W * h, _POS_W * h, 1e-2, _POS_W * h]
        qv = [_VEL_W * h, _VEL_W * h, 1e-5, _VEL_W * h]
        for i in range(4):
            a, b, c = self.P[i]
            self.p[i] += dt * self.v[i]
            self.P[i] = [a + 2 * dt * b + dt * dt * c + qp[i] ** 2, b + dt * c, c + qv[i] ** 2]

    def update(self, cx: float, cy: float, w: float, h: float) -> None:
        """Corrects the prediction with what the detector found."""
        h = max(h, 1e-6)
        z = [cx, cy, w / h, h]
        hp = max(self.p[3], 1e-6)
        r = [_POS_W * hp, _POS_W * hp, 1e-1, _POS_W * hp]
        for i in range(4):
            a, b, c = self.P[i]
            s = a + r[i] ** 2
            innovation = z[i] - self.p[i]
            self.p[i] += a / s * innovation
            self.v[i] += b / s * innovation
            self.P[i] = [a - a * a / s, b - a * b / s, c - b * b / s]

    @property
    def box(self) -> tuple[float, float, float, float]:
        """The predicted box as (centre x, centre y, width, height)."""
        h = max(self.p[3], 1e-6)
        return self.p[0], self.p[1], max(self.p[2], 1e-6) * h, h


def iou(a: tuple[float, float, float, float], b: tuple[float, float, float, float]) -> float:
    """Overlap of two boxes given as (centre x, centre y, width, height)."""
    iw = min(a[0] + a[2] / 2, b[0] + b[2] / 2) - max(a[0] - a[2] / 2, b[0] - b[2] / 2)
    ih = min(a[1] + a[3] / 2, b[1] + b[3] / 2) - max(a[1] - a[3] / 2, b[1] - b[3] / 2)
    if iw <= 0 or ih <= 0:
        return 0.0
    inter = iw * ih
    return inter / (a[2] * a[3] + b[2] * b[3] - inter)


def hungarian(cost: list[list[float]]) -> list[tuple[int, int]]:
    """The assignment of rows to columns with the smallest total cost, as (row, column) pairs (Hungarian algorithm)."""
    n = len(cost)
    if n == 0 or not cost[0]:
        return []
    m = len(cost[0])
    if n > m:
        return [(i, j) for j, i in hungarian([list(col) for col in zip(*cost)])]
    inf = float("inf")
    u, v = [0.0] * (n + 1), [0.0] * (m + 1)
    p, way = [0] * (m + 1), [0] * (m + 1)
    for i in range(1, n + 1):
        p[0] = i
        j0 = 0
        minv, used = [inf] * (m + 1), [False] * (m + 1)
        while True:
            used[j0] = True
            i0, delta, j1 = p[j0], inf, 0
            for j in range(1, m + 1):
                if not used[j]:
                    cur = cost[i0 - 1][j - 1] - u[i0] - v[j]
                    if cur < minv[j]:
                        minv[j], way[j] = cur, j0
                    if minv[j] < delta:
                        delta, j1 = minv[j], j
            for j in range(m + 1):
                if used[j]:
                    u[p[j]] += delta
                    v[j] -= delta
                else:
                    minv[j] -= delta
            j0 = j1
            if p[j0] == 0:
                break
        while True:
            j1 = way[j0]
            p[j0] = p[j1]
            j0 = j1
            if j0 == 0:
                break
    return [(p[j] - 1, j - 1) for j in range(1, m + 1) if p[j] != 0]


def _associate(
    preds: list[tuple[float, float, float, float]],
    dets: list[tuple[float, float, float, float]],
    scores: list[float] | None,
    tracks: list[int],
    det_ids: list[int],
    thresh: float,
    matched: dict[int, int],
) -> tuple[list[int], list[int]]:
    """Matches the given tracks to the given detections by overlap; records the pairs in `matched` ({detection: track})
    and returns the tracks and detections that are left."""
    if not tracks or not det_ids:
        return tracks, det_ids
    cost = [
        [1.0 - iou(preds[ti], dets[di]) * (scores[di] if scores is not None else 1.0) for di in det_ids]
        for ti in tracks
    ]
    used_t: set[int] = set()
    used_d: set[int] = set()
    for r, c in hungarian(cost):
        if cost[r][c] <= thresh:
            matched[det_ids[c]] = tracks[r]
            used_t.add(tracks[r])
            used_d.add(det_ids[c])
    return [t for t in tracks if t not in used_t], [d for d in det_ids if d not in used_d]


def match(
    tracks: list[Any],
    dets: list[tuple[float, float, float, float]],
    scores: list[float],
    t: float,
    unit_gap: float,
    previous_t: float | None,
    gate: float = 1.0,
    high: float | None = None,
) -> tuple[dict[int, int], set[int]]:
    """Matches this picture's detections to the followed birds.

    tracks: the birds being followed, as behavior._Track (they need .kf, .kf_t, .last_t, .box and .size).
    dets: the detections as (centre x, centre y, width, height); scores: the detector's confidence for each.
    unit_gap: the usual time between pictures, in seconds (the Kalman filter counts in pictures).
    Returns ({detection: bird index}, the detections that start a new bird)."""
    high = HIGH_SCORE if high is None else high
    preds = []
    for trk in tracks:
        trk.kf.predict(max(0.0, (t - trk.kf_t) / unit_gap))
        trk.kf_t = t
        preds.append(trk.kf.box)

    matched: dict[int, int] = {}
    free = list(range(len(tracks)))
    confident = [d for d in range(len(dets)) if scores[d] >= high]
    weak = [d for d in range(len(dets)) if scores[d] < high]

    # First association: confident detections against every bird, lost ones included.
    free, confident_left = _associate(preds, dets, scores, free, confident, MATCH_THRESH, matched)
    # Second association: weak detections against the birds seen in the previous picture that are still unmatched.
    recent = [ti for ti in free if previous_t is not None and tracks[ti].last_t >= previous_t - 1e-9]
    recent_left, weak_left = _associate(preds, dets, None, recent, weak, LOW_MATCH_THRESH, matched)
    free = [ti for ti in free if ti not in recent or ti in recent_left]

    # Third pass (adaptation to pictures a few seconds apart): what is left is paired by distance, nearest first.
    pairs = []
    for ti in free:
        trk = tracks[ti]
        for di in confident_left + weak_left:
            size = max(trk.size, math.sqrt(dets[di][2] * dets[di][3]))
            d = math.hypot(dets[di][0] - trk.box[0], dets[di][1] - trk.box[1]) / size
            if d <= gate:
                pairs.append((d - 0.5 * iou(trk.box, dets[di]), ti, di))
    pairs.sort()
    used_t: set[int] = set()
    for _, ti, di in pairs:
        if ti in used_t or di in matched:
            continue
        used_t.add(ti)
        matched[di] = ti
    return matched, {di for di in range(len(dets)) if di not in matched}
