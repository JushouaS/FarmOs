"""
ByteTrack (Zhang et al., "ByteTrack: Multi-Object Tracking by Associating Every
Detection Box", ECCV 2022), written to make the same decisions as Ultralytics'
BYTETracker (8.4.x), which is what the klydel branch of BehaviorMonitoring runs
through `model.track()`. tests/test_bytetrack.py feeds both the same detections
and checks that the IDs and boxes agree frame by frame.

Pure Python, so the same file can run on the Raspberry Pi next to the detector.
scipy's assignment solver is used when it is installed and a plain Hungarian
solver otherwise; both solve the same problem.

How one update works (a frame here is one sampled picture, e.g. every 2 s):

  0. Split the detections by score: high (>= track_high_thresh) and low
     (track_low_thresh < score < track_high_thresh). Lower ones are dropped.
  1. Predict every tracked and lost track one frame ahead with its Kalman
     filter (constant velocity on centre x, centre y, aspect ratio, height).
     A lost track's height velocity is zeroed first, so it does not keep
     growing or shrinking while nobody sees it.
  2. First association: high detections against tracked + lost tracks, cost
     1 - IoU (times the score when fuse_score is on), solved optimally with a
     cost limit of match_thresh. A lost track that matches is "re-found" and
     keeps its ID.
  3. Second association, the BYTE step: the tracks still unmatched that were
     tracked in the previous frame against the LOW detections, cost 1 - IoU,
     limit 0.5. A bird whose score dips (turned, half hidden) keeps its ID.
     Tracks left over now become lost.
  4. Unconfirmed tracks (started last frame, seen once) against the high
     detections left from step 2, limit 0.7. A match confirms them; a miss
     removes them, so a one-frame false box never gets an output ID.
  5. A high detection still left starts a new track only if its score is at
     least new_track_thresh. It is output from its second sighting (or at once
     on the very first frame).
  6. A lost track is removed after track_buffer frames without a match.
  7. Tracked and lost tracks that overlap almost completely (IoU > 0.85) are
     the same bird twice; the younger one is dropped.

Two details copied from Ultralytics on purpose, so results stay comparable:
  - Only matched, confirmed tracks are output, with their Kalman-corrected box.
  - A lost track removed in a frame is only taken out of the lost list in the
    next frame, so it can still be re-found once more. That is how the
    reference code orders its list updates.

What `match_thresh` means: it limits the COST (1 - IoU), so 0.8 accepts
IoU >= 0.2 and 0.95 accepts IoU >= 0.05. (klydel's yaml comment reads 0.95 as
"IoU >= 0.5"; it is not.)
"""
from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Iterable, Sequence

# Track states, as in the reference implementation.
NEW, TRACKED, LOST, REMOVED = 0, 1, 2, 3

#: Fixed limits in the reference implementation (not exposed there either).
SECOND_MATCH_THRESH = 0.5
UNCONFIRMED_MATCH_THRESH = 0.7
DUPLICATE_DIST = 0.15          # IoU distance below this = the same bird twice (IoU > 0.85)
REMOVED_BUFFER = 1000

_STD_POS = 1.0 / 20            # Kalman noise weights, relative to the box height
_STD_VEL = 1.0 / 160
_EPS = 1e-7


def _env_float(name: str, default: float) -> float:
    try:
        return float(os.getenv(name, str(default)))
    except ValueError:
        return default


@dataclass(frozen=True)
class ByteTrackConfig:
    """The tracker's settings. Defaults are the paper's (and klydel's
    configs/bytetrack_broiler.yaml), except match_thresh, which klydel sets to
    0.95: the paper's 0.8 is kept here until a sweep on our footage says
    otherwise."""

    track_high_thresh: float = 0.6
    track_low_thresh: float = 0.1
    new_track_thresh: float = 0.7
    track_buffer: int = 30            # frames, not seconds: 30 x 2 s sampling = 60 s
    match_thresh: float = 0.8
    fuse_score: bool = False

    @classmethod
    def from_env(cls) -> "ByteTrackConfig":
        d = cls()
        return cls(
            track_high_thresh=_env_float("BYTETRACK_HIGH_THRESH", d.track_high_thresh),
            track_low_thresh=_env_float("BYTETRACK_LOW_THRESH", d.track_low_thresh),
            new_track_thresh=_env_float("BYTETRACK_NEW_TRACK_THRESH", d.new_track_thresh),
            track_buffer=int(_env_float("BYTETRACK_BUFFER", d.track_buffer)),
            match_thresh=_env_float("BYTETRACK_MATCH_THRESH", d.match_thresh),
            fuse_score=os.getenv("BYTETRACK_FUSE_SCORE", str(d.fuse_score)).lower() in ("1", "true", "yes"),
        )


# ---------------------------------------------------------------------------
# Kalman filter
# ---------------------------------------------------------------------------

class KalmanXYAH:
    """The ByteTrack Kalman filter: state (cx, cy, a, h) plus a velocity for
    each, measurement (cx, cy, a, h) with a = w / h.

    The reference filter is one 8x8 system, but its motion, process noise and
    measurement noise only ever couple a coordinate with its own velocity, so
    it splits exactly into four 2-state filters. Each keeps its covariance as
    [var(position), cov(position, velocity), var(velocity)]."""

    __slots__ = ("mean", "vel", "cov")

    def __init__(self, xyah: Sequence[float]) -> None:
        h = xyah[3]
        self.mean = [float(v) for v in xyah]
        self.vel = [0.0, 0.0, 0.0, 0.0]
        sp = (2 * _STD_POS * h, 2 * _STD_POS * h, 1e-2, 2 * _STD_POS * h)
        sv = (10 * _STD_VEL * h, 10 * _STD_VEL * h, 1e-5, 10 * _STD_VEL * h)
        self.cov = [[p * p, 0.0, v * v] for p, v in zip(sp, sv)]

    def predict(self) -> None:
        h = self.mean[3]
        qp = (_STD_POS * h, _STD_POS * h, 1e-2, _STD_POS * h)
        qv = (_STD_VEL * h, _STD_VEL * h, 1e-5, _STD_VEL * h)
        for i in range(4):
            a, b, c = self.cov[i]
            self.mean[i] += self.vel[i]
            self.cov[i] = [a + 2 * b + c + qp[i] ** 2, b + c, c + qv[i] ** 2]

    def update(self, xyah: Sequence[float]) -> None:
        h = self.mean[3]
        r = (_STD_POS * h, _STD_POS * h, 1e-1, _STD_POS * h)
        for i in range(4):
            a, b, c = self.cov[i]
            s = a + r[i] ** 2
            k_pos, k_vel = a / s, b / s
            innovation = xyah[i] - self.mean[i]
            self.mean[i] += k_pos * innovation
            self.vel[i] += k_vel * innovation
            self.cov[i] = [a - k_pos * a, b - k_pos * b, c - k_vel * b]


# ---------------------------------------------------------------------------
# Geometry and assignment
# ---------------------------------------------------------------------------

def tlwh_to_xyah(tlwh: Sequence[float]) -> list[float]:
    x, y, w, h = tlwh
    return [x + w / 2, y + h / 2, w / h, h]


def xywh_to_tlwh(xywh: Sequence[float]) -> list[float]:
    cx, cy, w, h = xywh
    return [cx - w / 2, cy - h / 2, w, h]


def iou_xyxy(a: Sequence[float], b: Sequence[float]) -> float:
    """IoU of two (x1, y1, x2, y2) boxes, with the reference code's epsilon."""
    iw = min(a[2], b[2]) - max(a[0], b[0])
    ih = min(a[3], b[3]) - max(a[1], b[1])
    inter = max(0.0, iw) * max(0.0, ih)
    union = (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - inter
    return inter / (union + _EPS)


def iou_distance(a: list[Sequence[float]], b: list[Sequence[float]]) -> list[list[float]]:
    return [[1.0 - iou_xyxy(x, y) for y in b] for x in a]


def _hungarian(cost: list[list[float]]) -> list[int]:
    """Optimal assignment for a SQUARE cost matrix; returns the column of each row."""
    n = len(cost)
    inf = float("inf")
    u, v = [0.0] * (n + 1), [0.0] * (n + 1)
    p, way = [0] * (n + 1), [0] * (n + 1)
    for i in range(1, n + 1):
        p[0] = i
        j0 = 0
        minv, used = [inf] * (n + 1), [False] * (n + 1)
        while True:
            used[j0] = True
            i0, delta, j1 = p[j0], inf, 0
            row = cost[i0 - 1]
            for j in range(1, n + 1):
                if not used[j]:
                    cur = row[j - 1] - u[i0] - v[j]
                    if cur < minv[j]:
                        minv[j], way[j] = cur, j0
                    if minv[j] < delta:
                        delta, j1 = minv[j], j
            for j in range(n + 1):
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
    col_of_row = [0] * n
    for j in range(1, n + 1):
        if p[j]:
            col_of_row[p[j] - 1] = j - 1
    return col_of_row


def _solve_square(cost: list[list[float]]) -> list[int]:
    try:
        import numpy as np
        from scipy.optimize import linear_sum_assignment
    except ImportError:
        return _hungarian(cost)
    rows, cols = linear_sum_assignment(np.asarray(cost, dtype=float))
    out = [0] * len(cost)
    for r, c in zip(rows, cols):
        out[int(r)] = int(c)
    return out


def linear_assignment(
    cost: list[list[float]], thresh: float, n_cols: int | None = None
) -> tuple[list[tuple[int, int]], list[int], list[int]]:
    """Optimal one-to-one matching in which no pair may cost more than `thresh`.

    Same construction as lap.lapjv(extend_cost=True, cost_limit=thresh), which
    the reference uses: every row and every column also gets a "stay unmatched"
    option costing thresh / 2, so a pair is only worth making when it costs
    less than leaving both sides unmatched. Returns (matches, unmatched rows,
    unmatched columns). Pass n_cols when there may be no rows: an empty matrix
    cannot say how many columns it has."""
    n = len(cost)
    m = n_cols if n_cols is not None else (len(cost[0]) if n else 0)
    if n == 0 or m == 0:
        return [], list(range(n)), list(range(m))
    size = n + m
    half = thresh / 2.0
    ext = [[half] * size for _ in range(size)]
    for i in range(n):
        ext[i][:m] = cost[i]
    for i in range(n, size):
        for j in range(m, size):
            ext[i][j] = 0.0
    col_of_row = _solve_square(ext)
    matches = [(i, col_of_row[i]) for i in range(n) if col_of_row[i] < m]
    matched_cols = {j for _, j in matches}
    unmatched_rows = [i for i in range(n) if col_of_row[i] >= m]
    unmatched_cols = [j for j in range(m) if j not in matched_cols]
    return matches, unmatched_rows, unmatched_cols


# ---------------------------------------------------------------------------
# Tracks
# ---------------------------------------------------------------------------

class _Det:
    """One detection on its way into the tracker."""

    __slots__ = ("tlwh", "score", "index")

    def __init__(self, tlwh: list[float], score: float, index: int) -> None:
        self.tlwh = tlwh
        self.score = score
        self.index = index

    @property
    def xyxy(self) -> list[float]:
        x, y, w, h = self.tlwh
        return [x, y, x + w, y + h]


class STrack:
    """One followed bird."""

    __slots__ = ("track_id", "state", "is_activated", "score", "start_frame",
                 "frame_id", "tracklet_len", "kf", "det_index")

    def __init__(self, det: _Det, track_id: int, frame_id: int) -> None:
        self.track_id = track_id
        self.kf = KalmanXYAH(tlwh_to_xyah(det.tlwh))
        self.state = TRACKED
        self.is_activated = frame_id == 1   # only the first frame's tracks are confirmed at once
        self.score = det.score
        self.start_frame = frame_id
        self.frame_id = frame_id
        self.tracklet_len = 0
        self.det_index = det.index

    @property
    def end_frame(self) -> int:
        return self.frame_id

    @property
    def tlwh(self) -> list[float]:
        cx, cy, a, h = self.kf.mean
        w = a * h
        return [cx - w / 2, cy - h / 2, w, h]

    @property
    def xyxy(self) -> list[float]:
        x, y, w, h = self.tlwh
        return [x, y, x + w, y + h]

    @property
    def xywh(self) -> list[float]:
        cx, cy, a, h = self.kf.mean
        return [cx, cy, a * h, h]

    def predict(self) -> None:
        if self.state != TRACKED:
            self.kf.vel[3] = 0.0
        self.kf.predict()

    def update(self, det: _Det, frame_id: int) -> None:
        self.frame_id = frame_id
        self.tracklet_len += 1
        self.kf.update(tlwh_to_xyah(det.tlwh))
        self.state = TRACKED
        self.is_activated = True
        self.score = det.score
        self.det_index = det.index

    def re_activate(self, det: _Det, frame_id: int) -> None:
        self.kf.update(tlwh_to_xyah(det.tlwh))
        self.tracklet_len = 0
        self.state = TRACKED
        self.is_activated = True
        self.frame_id = frame_id
        self.score = det.score
        self.det_index = det.index


@dataclass(frozen=True)
class TrackOutput:
    """One confirmed bird in this frame. box is (cx, cy, w, h), Kalman-corrected."""

    track_id: int
    box: tuple[float, float, float, float]
    score: float
    det_index: int


def _joint(a: list[STrack], b: list[STrack]) -> list[STrack]:
    seen = {t.track_id for t in a}
    return a + [t for t in b if t.track_id not in seen]


def _sub(a: list[STrack], b: list[STrack]) -> list[STrack]:
    drop = {t.track_id for t in b}
    return [t for t in a if t.track_id not in drop]


def _remove_duplicates(a: list[STrack], b: list[STrack]) -> tuple[list[STrack], list[STrack]]:
    if not a or not b:
        return a, b
    dist = iou_distance([t.xyxy for t in a], [t.xyxy for t in b])
    dup_a, dup_b = set(), set()
    for p in range(len(a)):
        for q in range(len(b)):
            if dist[p][q] < DUPLICATE_DIST:
                if a[p].frame_id - a[p].start_frame > b[q].frame_id - b[q].start_frame:
                    dup_b.add(q)
                else:
                    dup_a.add(p)
    return ([t for i, t in enumerate(a) if i not in dup_a],
            [t for i, t in enumerate(b) if i not in dup_b])


# ---------------------------------------------------------------------------
# Tracker
# ---------------------------------------------------------------------------

class BYTETracker:
    def __init__(self, config: ByteTrackConfig | None = None) -> None:
        self.config = config or ByteTrackConfig()
        self.reset()

    def reset(self) -> None:
        """Forget every bird, e.g. after a gap in the recording."""
        self.tracked: list[STrack] = []
        self.lost: list[STrack] = []
        self.removed: list[STrack] = []
        self.frame_id = 0
        self._next_id = 0

    def _new_id(self) -> int:
        self._next_id += 1
        return self._next_id

    def _dists(self, tracks: list[STrack], dets: list[_Det]) -> list[list[float]]:
        dist = iou_distance([t.xyxy for t in tracks], [d.xyxy for d in dets])
        if self.config.fuse_score:
            dist = [[1.0 - (1.0 - c) * d.score for c, d in zip(row, dets)] for row in dist]
        return dist

    def update(self, detections: Iterable[Sequence[float]]) -> list[TrackOutput]:
        """detections: (cx, cy, w, h, score) per box, in pixels. Returns the
        confirmed birds matched in this frame."""
        cfg = self.config
        self.frame_id += 1
        activated: list[STrack] = []
        refind: list[STrack] = []
        lost: list[STrack] = []
        removed: list[STrack] = []

        high: list[_Det] = []
        low: list[_Det] = []
        for i, d in enumerate(detections):
            cx, cy, w, h, score = (float(v) for v in d[:5])
            if w <= 0 or h <= 0:
                continue
            det = _Det(xywh_to_tlwh((cx, cy, w, h)), score, i)
            if score >= cfg.track_high_thresh:
                high.append(det)
            elif score > cfg.track_low_thresh:
                low.append(det)

        unconfirmed = [t for t in self.tracked if not t.is_activated]
        confirmed = [t for t in self.tracked if t.is_activated]
        pool = _joint(confirmed, self.lost)
        for t in pool:
            t.predict()

        # 1. High detections against tracked + lost tracks.
        matches, u_track, u_det = linear_assignment(self._dists(pool, high), cfg.match_thresh, len(high))
        for ti, di in matches:
            self._apply(pool[ti], high[di], activated, refind)

        # 2. Low detections against tracks that were tracked until now (the BYTE step).
        remaining = [pool[i] for i in u_track if pool[i].state == TRACKED]
        if remaining and low:
            matches2, u_rem, _ = linear_assignment(
                iou_distance([t.xyxy for t in remaining], [d.xyxy for d in low]), SECOND_MATCH_THRESH)
            for ti, di in matches2:
                self._apply(remaining[ti], low[di], activated, refind)
        else:
            u_rem = list(range(len(remaining)))
        for i in u_rem:
            t = remaining[i]
            if t.state != LOST:
                t.state = LOST
                lost.append(t)

        # 3. Unconfirmed tracks against the high detections still left.
        left = [high[i] for i in u_det]
        if unconfirmed:
            matches3, u_unc, u_left = linear_assignment(
                self._dists(unconfirmed, left), UNCONFIRMED_MATCH_THRESH, len(left))
            for ti, di in matches3:
                unconfirmed[ti].update(left[di], self.frame_id)
                activated.append(unconfirmed[ti])
            for i in u_unc:
                unconfirmed[i].state = REMOVED
                removed.append(unconfirmed[i])
        else:
            u_left = list(range(len(left)))

        # 4. New tracks, only from confident detections.
        for i in u_left:
            det = left[i]
            if det.score < cfg.new_track_thresh:
                continue
            activated.append(STrack(det, self._new_id(), self.frame_id))

        # 5. Lost tracks unseen for longer than the buffer are removed.
        for t in self.lost:
            if self.frame_id - t.end_frame > cfg.track_buffer:
                t.state = REMOVED
                removed.append(t)

        # 6. Merge the pools, in the reference order.
        self.tracked = [t for t in self.tracked if t.state == TRACKED]
        self.tracked = _joint(self.tracked, activated)
        self.tracked = _joint(self.tracked, refind)
        self.lost = _sub(self.lost, self.tracked)
        self.lost.extend(lost)
        self.lost = _sub(self.lost, self.removed)
        self.tracked, self.lost = _remove_duplicates(self.tracked, self.lost)
        self.removed.extend(removed)
        if len(self.removed) > REMOVED_BUFFER:
            self.removed = self.removed[-REMOVED_BUFFER:]

        return [
            TrackOutput(t.track_id, tuple(t.xywh), t.score, t.det_index)
            for t in self.tracked if t.is_activated
        ]

    def _apply(self, track: STrack, det: _Det, activated: list[STrack], refind: list[STrack]) -> None:
        if track.state == TRACKED:
            track.update(det, self.frame_id)
            activated.append(track)
        else:
            track.re_activate(det, self.frame_id)
            refind.append(track)
