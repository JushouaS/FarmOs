"""
Stable bird numbers on top of ByteTrack: klydel's "Hybrid V2".

Ported from github.com/kyaanise1/BehaviorMonitoring, branch klydel, commit
9c6f755 (2026-11-07): behavior-pipeline/hybrid_tracker.py (HybridIDManager)
and behavior-pipeline/hybrid_tracker_v2.py (RecoveryHybrid). That branch is
still being worked on; check it for changes before relying on these numbers,
and update the commit above when porting again. The logic below is theirs,
line for line, apart from naming; tests/test_stable_ids.py pins it.

Why a second layer: ByteTrack follows birds by box overlap. Sampled every 2 s,
a bird that stands still is easy, but ByteTrack can still hand it a new ID
after a missed frame or swap two IDs in a crowd, and every new ID restarts the
bird's inactivity clock. This layer keeps its own numbers ("stable IDs"):

  HybridIDManager, three one-to-one passes per frame:
    1. tight centroid match (within tight x body length): a bird that has not
       moved keeps its number whatever ByteTrack called it;
    2. same ByteTrack ID, if the jump is no more than wide x body length;
    3. wide centroid rescue (within wide x body length, score >= wide_conf).
  Every pass also refuses a box whose width or height changed by more than
  max_size_ratio. A stable ID survives max_missed frames unmatched. Any
  ByteTrack box still unmatched gets a new stable ID, so no box is hidden.

  RecoveryHybrid, afterwards: a raw detection with score >= recovery_conf that
  is not already one of the output boxes is given back to a stable ID that
  went missing in the last max_missed frames, if it is within
  recovery_distance x body length and the size check passes. This is how a
  bird ByteTrack has only just restarted (unconfirmed, so not output yet) keeps
  its old number. It never creates a new ID.

klydel runs the detector twice per frame (once inside model.track(), once for
the raw boxes); with the same weights and confidence both see the same boxes,
so BroilerTracker below detects once and gives the same list to both.
"""
from __future__ import annotations

import math
import os
import statistics
from collections import deque
from dataclasses import dataclass
from typing import Iterable, Sequence

from bytetrack import BYTETracker, ByteTrackConfig, _env_float

#: The klydel commit the ported tracking and behaviour rules match. The tracking (hybrid_tracker.py,
#: hybrid_tracker_v2.py) is unchanged from 9c6f755; behavior_rules.py follows a365f3d.
KLYDEL_COMMIT = "a365f3d"


def _iou_cxcywh(a: Sequence[float], b: Sequence[float]) -> float:
    """IoU for two (cx, cy, w, h) boxes, as klydel computes it (no epsilon)."""
    ax, ay, aw, ah = map(float, a[:4])
    bx, by, bw, bh = map(float, b[:4])
    al, at, ar, ab = ax - aw / 2, ay - ah / 2, ax + aw / 2, ay + ah / 2
    bl, bt, br, bb = bx - bw / 2, by - bh / 2, bx + bw / 2, by + bh / 2
    w = max(0.0, min(ar, br) - max(al, bl))
    h = max(0.0, min(ab, bb) - max(at, bt))
    inter = w * h
    union = max(0.0, aw * ah) + max(0.0, bw * bh) - inter
    return inter / union if union > 0 else 0.0


class _HybridTrack:
    __slots__ = ("id", "byte_id", "cx", "cy", "w", "h", "missed", "hits")

    def __init__(self, tid: int, byte_id: int, cx: float, cy: float, w: float, h: float) -> None:
        self.id, self.byte_id = tid, int(byte_id)
        self.cx, self.cy, self.w, self.h = cx, cy, w, h
        self.missed, self.hits = 0, 1


class HybridIDManager:
    """Stable IDs for ByteTrack's output (klydel hybrid_tracker.py)."""

    def __init__(self, tight_frac: float = 0.5, wide_frac: float = 4.0, max_missed: int = 4,
                 wide_conf: float = 0.3, max_size_ratio: float = 2.0, body_window: int = 200) -> None:
        if not (0 < tight_frac <= wide_frac):
            raise ValueError("Require 0 < tight_frac <= wide_frac")
        if max_missed < 0:
            raise ValueError("max_missed must be non-negative")
        if max_size_ratio < 1:
            raise ValueError("max_size_ratio must be >= 1")
        self.tight_frac = float(tight_frac)
        self.wide_frac = float(wide_frac)
        self.max_missed = int(max_missed)
        self.wide_conf = float(wide_conf)
        self.max_size_ratio = float(max_size_ratio)
        self._body: deque[float] = deque(maxlen=body_window)
        self.tracks: dict[int, _HybridTrack] = {}
        self.next_id = 1

    def body_length(self) -> float:
        return statistics.median(self._body) if self._body else 1.0

    def _valid_size(self, tr: _HybridTrack, box: Sequence[float]) -> bool:
        _, _, w, h = box
        if min(tr.w, tr.h, w, h) <= 0:
            return False
        return max(tr.w / w, w / tr.w, tr.h / h, h / tr.h) <= self.max_size_ratio

    @staticmethod
    def _dist(tr: _HybridTrack, box: Sequence[float]) -> float:
        return math.hypot(tr.cx - box[0], tr.cy - box[1])

    def _greedy(self, tids, dids, boxes, body, frac) -> dict[int, int]:
        candidates = []
        for tid in tids:
            tr = self.tracks[tid]
            for di in dids:
                if self._valid_size(tr, boxes[di]):
                    distance = self._dist(tr, boxes[di])
                    if distance <= frac * body:
                        candidates.append((distance, tid, di))
        candidates.sort()
        out: dict[int, int] = {}
        used_d: set[int] = set()
        for _, tid, di in candidates:
            if tid not in out and di not in used_d:
                out[tid] = di
                used_d.add(di)
        return out

    def update(self, byte_ids, xywh, scores):
        """ByteTrack IDs, (cx, cy, w, h) boxes and scores in; (stable_ids, boxes, scores) out, same order."""
        if not (len(byte_ids) == len(xywh) == len(scores)):
            raise ValueError("byte_ids, xywh, scores must be equal-length")
        if len(set(int(v) for v in byte_ids)) != len(byte_ids):
            raise ValueError("ByteTrack returned duplicate IDs in a single frame")

        boxes = [tuple(map(float, box)) for box in xywh]
        if boxes:
            body_values = [max(b[2], b[3]) for b in boxes if b[2] > 0 and b[3] > 0]
            if body_values:
                self._body.append(statistics.median(body_values))
        body = self.body_length()

        tids = list(self.tracks)
        dids = list(range(len(boxes)))
        matched = self._greedy(tids, dids, boxes, body, self.tight_frac)

        # Pass 2: ByteTrack's own association, rejecting huge jumps.
        used_d = set(matched.values())
        bt_candidates = []
        for tid in tids:
            if tid in matched:
                continue
            tr = self.tracks[tid]
            for di in dids:
                if di in used_d or int(byte_ids[di]) != tr.byte_id:
                    continue
                if self._valid_size(tr, boxes[di]):
                    distance = self._dist(tr, boxes[di])
                    if distance <= self.wide_frac * body:
                        bt_candidates.append((distance, tid, di))
        bt_candidates.sort()
        for _, tid, di in bt_candidates:
            if tid not in matched and di not in used_d:
                matched[tid] = di
                used_d.add(di)

        # Pass 3: wide centroid rescue.
        rem_t = [tid for tid in tids if tid not in matched]
        rem_d = [di for di in dids if di not in used_d and scores[di] >= self.wide_conf]
        matched.update(self._greedy(rem_t, rem_d, boxes, body, self.wide_frac))

        stable: list[int | None] = [None] * len(boxes)
        for tid, di in matched.items():
            tr = self.tracks[tid]
            tr.cx, tr.cy, tr.w, tr.h = boxes[di]
            tr.byte_id = int(byte_ids[di])
            tr.missed = 0
            tr.hits += 1
            stable[di] = tid

        for tid in tids:
            if tid not in matched:
                self.tracks[tid].missed += 1
                if self.tracks[tid].missed > self.max_missed:
                    del self.tracks[tid]

        for di in dids:
            if stable[di] is None:
                tid = self.next_id
                self.next_id += 1
                self.tracks[tid] = _HybridTrack(tid, byte_ids[di], *boxes[di])
                stable[di] = tid

        assert len(set(stable)) == len(stable), "One stable ID was assigned twice in a frame"
        return stable, [list(b) for b in boxes], list(scores)


class RecoveryHybrid:
    """HybridIDManager plus recovery of confident detections ByteTrack did not
    output (klydel hybrid_tracker_v2.py)."""

    def __init__(self, tight: float = 0.5, wide: float = 4.0, max_missed: int = 4,
                 wide_conf: float = 0.3, size_ratio: float = 2.0,
                 recovery_conf: float = 0.7, recovery_distance: float = 1.5,
                 duplicate_iou: float = 0.5, duplicate_center: float = 0.25) -> None:
        if not 0 <= recovery_conf <= 1:
            raise ValueError("recovery_conf must be between 0 and 1")
        if not 0 < recovery_distance:
            raise ValueError("recovery_distance must be positive")
        if not 0 < duplicate_iou <= 1:
            raise ValueError("duplicate_iou must be in (0,1]")
        self.manager = HybridIDManager(tight_frac=tight, wide_frac=wide, max_missed=max_missed,
                                       wide_conf=wide_conf, max_size_ratio=size_ratio)
        self.recovery_conf = recovery_conf
        self.recovery_distance = recovery_distance
        self.duplicate_iou = duplicate_iou
        self.duplicate_center = duplicate_center
        self.frames = 0
        self.recovered_total = 0

    def update(self, byte_ids, byte_boxes, byte_scores, raw_boxes, raw_scores):
        """Returns (stable_ids, boxes, scores, recovered); recovered boxes come last."""
        if len(raw_boxes) != len(raw_scores):
            raise ValueError("raw_boxes and raw_scores must have equal length")
        stable_ids, boxes, scores = self.manager.update(byte_ids, byte_boxes, byte_scores)
        stable_ids, boxes, scores = list(stable_ids), list(boxes), list(scores)
        present = set(stable_ids)

        body = statistics.median(self.manager._body) if self.manager._body else 1.0
        raw_candidates = []
        for i, (box, score) in enumerate(zip(raw_boxes, raw_scores)):
            if float(score) < self.recovery_conf:
                continue
            b = list(map(float, box))
            if len(b) != 4 or b[2] <= 0 or b[3] <= 0:
                continue
            overlaps = any(
                _iou_cxcywh(b, existing) >= self.duplicate_iou
                or math.hypot(b[0] - existing[0], b[1] - existing[1]) <= self.duplicate_center * body
                for existing in boxes
            )
            if not overlaps:
                raw_candidates.append((i, b, float(score)))

        dormant = [tid for tid, tr in self.manager.tracks.items()
                   if tid not in present and 0 < tr.missed <= self.manager.max_missed]
        pairs = []
        for tid in dormant:
            tr = self.manager.tracks[tid]
            for i, b, score in raw_candidates:
                if not self.manager._valid_size(tr, b):
                    continue
                distance = math.hypot(tr.cx - b[0], tr.cy - b[1])
                if distance <= self.recovery_distance * body:
                    pairs.append((distance, -score, tid, i, b, score))
        pairs.sort()
        used_d: set[int] = set()
        recovered = 0
        for _, _, tid, i, b, score in pairs:
            if tid in present or i in used_d:
                continue
            if any(_iou_cxcywh(b, prev) >= self.duplicate_iou for prev in boxes):
                continue
            tr = self.manager.tracks[tid]
            tr.cx, tr.cy, tr.w, tr.h = b
            tr.missed = 0
            tr.hits += 1
            stable_ids.append(tid)
            boxes.append(b)
            scores.append(score)
            present.add(tid)
            used_d.add(i)
            recovered += 1
        assert len(stable_ids) == len(set(stable_ids)), "Duplicate stable IDs in one frame"
        self.frames += 1
        self.recovered_total += recovered
        return stable_ids, boxes, scores, recovered


# ---------------------------------------------------------------------------
# The whole tracker: detections in, stable bird numbers out
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class HybridConfig:
    """klydel's RecoveryHybrid settings, as used by its current runner."""

    tight: float = 0.5
    wide: float = 4.0
    max_missed: int = 4
    wide_conf: float = 0.3
    size_ratio: float = 2.0
    recovery_conf: float = 0.7
    recovery_distance: float = 1.5
    duplicate_iou: float = 0.5
    duplicate_center: float = 0.25

    @classmethod
    def from_env(cls) -> "HybridConfig":
        d = cls()
        return cls(
            tight=_env_float("HYBRID_TIGHT", d.tight),
            wide=_env_float("HYBRID_WIDE", d.wide),
            max_missed=int(_env_float("HYBRID_MAX_MISSED", d.max_missed)),
            wide_conf=_env_float("HYBRID_WIDE_CONF", d.wide_conf),
            size_ratio=_env_float("HYBRID_SIZE_RATIO", d.size_ratio),
            recovery_conf=_env_float("HYBRID_RECOVERY_CONF", d.recovery_conf),
            recovery_distance=_env_float("HYBRID_RECOVERY_DISTANCE", d.recovery_distance),
            duplicate_iou=_env_float("HYBRID_DUPLICATE_IOU", d.duplicate_iou),
            duplicate_center=_env_float("HYBRID_DUPLICATE_CENTER", d.duplicate_center),
        )


@dataclass(frozen=True)
class Bird:
    """One bird in one frame. box is (cx, cy, w, h) in pixels. byte_id is None
    for a bird given back by recovery (ByteTrack did not output it)."""

    stable_id: int
    byte_id: int | None
    box: tuple[float, float, float, float]
    score: float
    recovered: bool


class BroilerTracker:
    """ByteTrack, then klydel's stable IDs and recovery. Feed one sampled frame
    at a time with update(); call reset() after a gap in the recording."""

    def __init__(self, bytetrack: ByteTrackConfig | None = None, hybrid: HybridConfig | None = None) -> None:
        self.bytetrack_config = bytetrack or ByteTrackConfig()
        self.hybrid_config = hybrid or HybridConfig()
        self.reset()

    def reset(self) -> None:
        h = self.hybrid_config
        self.bytetrack = BYTETracker(self.bytetrack_config)
        self.hybrid = RecoveryHybrid(
            tight=h.tight, wide=h.wide, max_missed=h.max_missed, wide_conf=h.wide_conf,
            size_ratio=h.size_ratio, recovery_conf=h.recovery_conf,
            recovery_distance=h.recovery_distance, duplicate_iou=h.duplicate_iou,
            duplicate_center=h.duplicate_center,
        )

    def update(self, detections: Iterable[Sequence[float]]) -> list[Bird]:
        """detections: (cx, cy, w, h, score) per box, every box the detector
        kept (down to ByteTrack's low threshold)."""
        dets = [tuple(float(v) for v in d[:5]) for d in detections]
        outputs = self.bytetrack.update(dets)
        byte_ids = [o.track_id for o in outputs]
        byte_boxes = [list(o.box) for o in outputs]
        byte_scores = [o.score for o in outputs]
        raw_boxes = [list(d[:4]) for d in dets]
        raw_scores = [d[4] for d in dets]
        ids, boxes, scores, _ = self.hybrid.update(byte_ids, byte_boxes, byte_scores, raw_boxes, raw_scores)
        n_byte = len(outputs)
        return [
            Bird(
                stable_id=int(sid),
                byte_id=byte_ids[k] if k < n_byte else None,
                box=tuple(float(v) for v in box),
                score=float(score),
                recovered=k >= n_byte,
            )
            for k, (sid, box, score) in enumerate(zip(ids, boxes, scores))
        ]

    def body_length(self) -> float | None:
        """Median of the longer box side over recent frames, as the tracker sees it."""
        body = self.hybrid.manager._body
        return statistics.median(body) if body else None
