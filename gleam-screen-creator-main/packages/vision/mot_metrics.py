"""
Tracking accuracy: CLEAR MOT (MOTA, MOTP, ID switches) and IDF1.

Same rules as the motmetrics package that klydel's eval_tracking.py uses, so
the numbers can be compared with theirs, but with no pandas or motmetrics
needed at run time. tests/test_mot_metrics.py checks it against motmetrics.

Per frame (CLEAR MOT):
  1. A ground-truth bird keeps the tracker ID it was last matched to if that
     ID is present now and overlaps it with IoU >= iou_thr.
  2. The rest are matched optimally (most pairs first, then lowest 1 - IoU).
  3. A ground-truth bird matched to a different ID than last time is an ID
     switch. Unmatched ground truth is a miss (FN), unmatched output a false
     positive (FP).
  MOTA = 1 - (FN + FP + switches) / ground-truth boxes
  MOTP here is the mean IoU of the matched pairs (motmetrics reports 1 - IoU;
  klydel's script converts it the same way).

IDF1 matches whole identities, not frames: each ground-truth bird is paired
with at most one tracker ID over the whole clip, to maximise the frames in
which they coincide (IDTP). IDF1 = 2 IDTP / (ground-truth boxes + output boxes).
It is the number that says whether a bird keeps ONE number for the clip,
which is exactly what a 30-minute inactivity window needs.

Input format is MOTChallenge: frame,id,x,y,w,h,conf,... with x, y the top-left
corner, one row per box.
"""
from __future__ import annotations

import csv
from dataclasses import dataclass, field
from typing import Iterable

from bytetrack import _solve_square

#: Cost given to a pair that may not be matched; far above any real 1 - IoU.
_INVALID = 1e6


@dataclass
class MotSummary:
    num_frames: int = 0
    num_objects: int = 0          # ground-truth boxes
    num_predictions: int = 0      # tracker boxes
    num_matches: int = 0
    num_misses: int = 0
    num_false_positives: int = 0
    num_switches: int = 0
    iou_sum: float = 0.0
    idtp: int = 0
    gt_ids: int = 0
    pred_ids: int = 0
    per_frame: list[dict] = field(default_factory=list)

    @property
    def mota(self) -> float:
        if not self.num_objects:
            return 0.0
        return 1.0 - (self.num_misses + self.num_false_positives + self.num_switches) / self.num_objects

    @property
    def motp(self) -> float:
        """Mean IoU of matched pairs (higher is better)."""
        return self.iou_sum / self.num_matches if self.num_matches else 0.0

    @property
    def idf1(self) -> float:
        denom = self.num_objects + self.num_predictions
        return 2 * self.idtp / denom if denom else 0.0

    @property
    def idp(self) -> float:
        return self.idtp / self.num_predictions if self.num_predictions else 0.0

    @property
    def idr(self) -> float:
        return self.idtp / self.num_objects if self.num_objects else 0.0

    def as_dict(self) -> dict:
        return {
            "frames": self.num_frames,
            "gt_boxes": self.num_objects,
            "pred_boxes": self.num_predictions,
            "gt_ids": self.gt_ids,
            "pred_ids": self.pred_ids,
            "mota": round(self.mota, 4),
            "motp_iou": round(self.motp, 4),
            "idf1": round(self.idf1, 4),
            "idp": round(self.idp, 4),
            "idr": round(self.idr, 4),
            "id_switches": self.num_switches,
            "misses": self.num_misses,
            "false_positives": self.num_false_positives,
            "matches": self.num_matches,
        }


Frame = dict  # {id: (x, y, w, h)}


def _xyxy(b) -> tuple[float, float, float, float]:
    x, y, w, h = b
    return (x, y, x + w, y + h)


def _iou(a, b) -> float:
    ax, bx = _xyxy(a), _xyxy(b)
    iw = min(ax[2], bx[2]) - max(ax[0], bx[0])
    ih = min(ax[3], bx[3]) - max(ax[1], bx[1])
    inter = max(0.0, iw) * max(0.0, ih)
    union = a[2] * a[3] + b[2] * b[3] - inter
    return inter / union if union > 0 else 0.0


def _max_valid_assignment(cost: list[list[float | None]]) -> list[tuple[int, int]]:
    """Most valid pairs first, then the cheapest (None = not allowed)."""
    n = len(cost)
    m = len(cost[0]) if n else 0
    if not n or not m:
        return []
    size = max(n, m)
    square = [[_INVALID] * size for _ in range(size)]
    for i in range(n):
        for j in range(m):
            if cost[i][j] is not None:
                square[i][j] = cost[i][j]
    col_of_row = _solve_square(square)
    return [(i, col_of_row[i]) for i in range(n)
            if col_of_row[i] < m and cost[i][col_of_row[i]] is not None]


def evaluate(gt: dict[int, Frame], pred: dict[int, Frame], iou_thr: float = 0.5) -> MotSummary:
    """gt and pred: {frame: {id: (x, y, w, h)}}. Frames missing from either
    side count as empty."""
    s = MotSummary()
    last: dict[int, int] = {}            # gt id -> tracker id it was last matched to
    cooccur: dict[tuple[int, int], int] = {}
    gt_count: dict[int, int] = {}
    pred_count: dict[int, int] = {}

    for frame in sorted(set(gt) | set(pred)):
        g = gt.get(frame, {})
        p = pred.get(frame, {})
        s.num_frames += 1
        s.num_objects += len(g)
        s.num_predictions += len(p)
        for oid in g:
            gt_count[oid] = gt_count.get(oid, 0) + 1
        for hid in p:
            pred_count[hid] = pred_count.get(hid, 0) + 1

        ious = {(o, h): _iou(g[o], p[h]) for o in g for h in p}
        valid = {k: v for k, v in ious.items() if v >= iou_thr}
        for (o, h) in valid:
            cooccur[(o, h)] = cooccur.get((o, h), 0) + 1

        matched_o: set[int] = set()
        matched_h: set[int] = set()
        switches = 0
        # 1. Keep last frame's correspondences that still hold.
        for o in g:
            h = last.get(o)
            if h is not None and h in p and h not in matched_h and (o, h) in valid:
                matched_o.add(o)
                matched_h.add(h)
                s.num_matches += 1
                s.iou_sum += valid[(o, h)]
        # 2. Optimal matching for the rest.
        rest_o = [o for o in g if o not in matched_o]
        rest_h = [h for h in p if h not in matched_h]
        cost = [[(1.0 - valid[(o, h)]) if (o, h) in valid else None for h in rest_h] for o in rest_o]
        for i, j in _max_valid_assignment(cost):
            o, h = rest_o[i], rest_h[j]
            if o in last and last[o] != h:
                switches += 1
            last[o] = h
            matched_o.add(o)
            matched_h.add(h)
            s.num_matches += 1
            s.iou_sum += valid[(o, h)]
        misses = len(g) - len(matched_o)
        fps = len(p) - len(matched_h)
        s.num_switches += switches
        s.num_misses += misses
        s.num_false_positives += fps
        s.per_frame.append({"frame": frame, "gt": len(g), "pred": len(p),
                            "misses": misses, "fp": fps, "switches": switches})

    # IDF1: one tracker ID per ground-truth bird, maximising frames together.
    gids, hids = sorted(gt_count), sorted(pred_count)
    s.gt_ids, s.pred_ids = len(gids), len(hids)
    if gids and hids:
        s.idtp = _max_total_overlap(gids, hids, cooccur)
    return s


def _max_total_overlap(gids: list[int], hids: list[int], cooccur: dict[tuple[int, int], int]) -> int:
    """IDTP: the largest total of shared frames over one-to-one (gt id, tracker id) pairs."""
    size = max(len(gids), len(hids))
    square = [[0.0] * size for _ in range(size)]
    for i, o in enumerate(gids):
        for j, h in enumerate(hids):
            square[i][j] = -float(cooccur.get((o, h), 0))
    col_of_row = _solve_square(square)
    return sum(cooccur.get((gids[i], hids[col_of_row[i]]), 0)
               for i in range(len(gids)) if col_of_row[i] < len(hids))


def read_mot(path: str) -> dict[int, Frame]:
    """A MOTChallenge text file -> {frame: {id: (x, y, w, h)}}."""
    out: dict[int, Frame] = {}
    with open(path, newline="", encoding="utf-8") as fh:
        for row in csv.reader(fh):
            if not row or row[0].startswith("#"):
                continue
            frame, tid = int(float(row[0])), int(float(row[1]))
            out.setdefault(frame, {})[tid] = tuple(float(v) for v in row[2:6])
    return out


def write_mot(path: str, rows: Iterable[tuple[int, int, float, float, float, float, float]]) -> None:
    """rows: (frame, id, x, y, w, h, score) with x, y the top-left corner."""
    with open(path, "w", newline="", encoding="utf-8") as fh:
        for frame, tid, x, y, w, h, score in rows:
            fh.write(f"{frame},{tid},{x:.2f},{y:.2f},{w:.2f},{h:.2f},{score:.3f},-1,-1,-1\n")


#: The targets in the thesis proposal (klydel eval_tracking.py prints the same).
TARGETS = {"mota": 0.70, "idf1": 0.75, "motp_iou": 0.75}
