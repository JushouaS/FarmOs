"""
Huddling and inactivity over tracked birds: klydel's rules.

Ported from github.com/kyaanise1/BehaviorMonitoring, branch klydel, commit
9c6f755:
  behavior-pipeline/behavior.py                     (inactivity, body length)
  behavior-pipeline/hybridv2 behavior validation/
      behavior_linkage_test.py                      (linkage clustering)
      run_pipeline_hybrid_v2_feeder_aware_linkage_test.py
                                                    (feeder zones, strict clusters,
                                                     local and temporal recovery)
The logic is theirs, unchanged, apart from one generalisation: a feeder zone
may be a polygon (what Settings > Feeder zones saves) as well as klydel's
axis-aligned rectangles. With rectangles every number is computed exactly as
theirs; tests/test_behavior_rules.py replays klydel's own Day 6 run to check.

The rules, in plain words:

Body length: the median, over recent frames, of each frame's median longer box
side. Every distance below is in body lengths, so the rules do not change as
the birds grow or the camera moves.

Inactivity (klydel behavior.update_inactivity): a bird is inactive when its
centre stayed inside a box of move_frac x body length (default half a body)
for the whole window (default 30 min), it is visible now, and it was seen in
at least min_fill (half) of the window's frames. Its track must therefore last
the whole window: a gap resets it.

Huddling, the "strict" method klydel reports (Day 5: precision 0.90, recall
0.75, F1 0.82 at IoU 0.5, on development footage, not a hold-out):
  1. Birds whose centre is inside a feeder/drinker zone are left out; crowding
     at a feeder is feeding.
  2. Average-linkage grouping with a hard rule: EVERY pair in a group is closer
     than one body length (A near B and B near C does not put A with C).
     Groups of 3 or more.
  3. A group whose bounding box is cluster_zone_overlap (30 %) or more covered
     by zones is dropped.
  4. Local recovery: leftover birds that form a tight trio (every pair under a
     body length, mean pair distance <= 0.75 body) become a group too.
  5. Temporal recovery: a trio is also accepted when the 2 frames before and
     the 2 after support it (same tracks close together in all four). Each
     frame's answer is therefore known 2 frames (about 4 s) late.
"""
from __future__ import annotations

import math
import statistics
from collections import defaultdict, deque
from dataclasses import dataclass, field
from itertools import combinations
from typing import Iterable, Sequence

Box = Sequence[float]          # (cx, cy, w, h) in pixels


# ---------------------------------------------------------------------------
# Feeder / drinker zones
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class Zones:
    """Zones in frame pixels: axis-aligned rectangles (x1, y1, x2, y2) and polygons [(x, y), ...]."""

    rects: tuple[tuple[float, float, float, float], ...] = ()
    polygons: tuple[tuple[tuple[float, float], ...], ...] = ()

    def __bool__(self) -> bool:
        return bool(self.rects or self.polygons)

    def __len__(self) -> int:
        return len(self.rects) + len(self.polygons)

    @classmethod
    def from_klydel(cls, config: dict, frame_w: float, frame_h: float) -> "Zones":
        """klydel's configs/feeding_zones.json: {"ref_size": [w, h], "zones": [[x1, y1, x2, y2], ...]}."""
        ref_w, ref_h = config["ref_size"]
        sx, sy = frame_w / ref_w, frame_h / ref_h
        return cls(rects=tuple((x1 * sx, y1 * sy, x2 * sx, y2 * sy) for x1, y1, x2, y2 in config["zones"]))

    @classmethod
    def from_normalized(cls, polygons: Iterable[Sequence[Sequence[float]]], frame_w: float, frame_h: float) -> "Zones":
        """Settings' zones: polygons with points in 0..1. An axis-aligned 4-point polygon is kept as a rectangle."""
        rects, polys = [], []
        for poly in polygons:
            pts = [(float(x) * frame_w, float(y) * frame_h) for x, y in poly]
            if len(pts) < 3:
                continue
            xs, ys = sorted({p[0] for p in pts}), sorted({p[1] for p in pts})
            if len(pts) == 4 and len(xs) == 2 and len(ys) == 2:
                rects.append((xs[0], ys[0], xs[1], ys[1]))
            else:
                polys.append(tuple(pts))
        return cls(rects=tuple(rects), polygons=tuple(polys))

    def contains(self, x: float, y: float) -> bool:
        if any(x1 <= x <= x2 and y1 <= y <= y2 for x1, y1, x2, y2 in self.rects):
            return True
        return any(_point_in_polygon(x, y, p) for p in self.polygons)

    def covered_fraction(self, rect: tuple[float, float, float, float]) -> float:
        """Share of `rect` (x1, y1, x2, y2) covered by the union of the zones."""
        x1, y1, x2, y2 = rect
        area = max(0.0, x2 - x1) * max(0.0, y2 - y1)
        if area <= 0 or not self:
            return 0.0
        if not self.polygons:
            return min(1.0, _rect_union_area(rect, self.rects) / area)
        return _raster_fraction(rect, self)


def _point_in_polygon(x: float, y: float, poly: Sequence[tuple[float, float]]) -> bool:
    inside = False
    j = len(poly) - 1
    for i in range(len(poly)):
        xi, yi = poly[i]
        xj, yj = poly[j]
        if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi) + xi:
            inside = not inside
        j = i
    return inside


def _rect_union_area(rect, zones) -> float:
    """Exact area of rect covered by the union of rectangle zones (klydel's x-slab method)."""
    x1, y1, x2, y2 = rect
    intersections = []
    for zx1, zy1, zx2, zy2 in zones:
        r = (max(x1, zx1), max(y1, zy1), min(x2, zx2), min(y2, zy2))
        if r[0] < r[2] and r[1] < r[3]:
            intersections.append(r)
    if not intersections:
        return 0.0
    xs = sorted({x for a, _, b, _ in intersections for x in (a, b)})
    covered = 0.0
    for left, right in zip(xs, xs[1:]):
        intervals = sorted((ay, by) for ax, ay, bx, by in intersections if ax < right and bx > left)
        merged = 0.0
        bottom = top = None
        for lo, hi in intervals:
            if bottom is None:
                bottom, top = lo, hi
            elif lo <= top:
                top = max(top, hi)
            else:
                merged += top - bottom
                bottom, top = lo, hi
        if bottom is not None:
            merged += top - bottom
        covered += (right - left) * merged
    return covered


def _raster_fraction(rect, zones: Zones) -> float:
    """Polygon zones: the covered share measured on a pixel grid over the rectangle."""
    import cv2
    import numpy as np

    x1, y1, x2, y2 = rect
    w, h = max(1, int(math.ceil(x2 - x1))), max(1, int(math.ceil(y2 - y1)))
    mask = np.zeros((h, w), np.uint8)
    for zx1, zy1, zx2, zy2 in zones.rects:
        cv2.rectangle(mask, (int(round(zx1 - x1)), int(round(zy1 - y1))),
                      (int(round(zx2 - x1)) - 1, int(round(zy2 - y1)) - 1), 1, -1)
    for poly in zones.polygons:
        pts = np.round(np.array([(px - x1, py - y1) for px, py in poly])).astype(np.int32)
        cv2.fillPoly(mask, [pts], 1)
    return float(mask.mean())


# ---------------------------------------------------------------------------
# Inactivity and body length (klydel behavior.py)
# ---------------------------------------------------------------------------

def prune_history(history, now, window_s, interval_s):
    """Drop points older than the window and forget tracks not seen for a full window."""
    keep_from = now - window_s - 2 * interval_s
    for tid in list(history):
        pts = history[tid]
        while pts and pts[0][0] < keep_from:
            pts.popleft()
        if not pts or now - pts[-1][0] > window_s:
            del history[tid]


def update_inactivity(history, now, window_s=1800, move_thresh_px=15, min_samples=1):
    """IDs whose centre stayed inside a move_thresh_px box for window_s, seen now,
    with history spanning the whole window and at least min_samples points in it."""
    inactive = []
    for tid, pts in history.items():
        if not pts or pts[-1][0] != now:
            continue
        if now - pts[0][0] < window_s:
            continue
        recent = [p for p in pts if now - p[0] <= window_s]
        if len(recent) < min_samples:
            continue
        xs = [p[1] for p in recent]
        ys = [p[2] for p in recent]
        if (max(xs) - min(xs)) < move_thresh_px and (max(ys) - min(ys)) < move_thresh_px:
            inactive.append(tid)
    return inactive


def estimate_body_length(boxes_wh):
    """Median of the longer box side across birds, in pixels."""
    if not boxes_wh:
        return None
    return statistics.median(max(w, h) for w, h in boxes_wh)


# ---------------------------------------------------------------------------
# Grouping (klydel behavior.py / behavior_linkage_test.py / linkage runner)
# ---------------------------------------------------------------------------

def detect_huddles(centroids, body_len_px, min_birds=3):
    """Connected components: chained closeness. Kept for comparison; it over-merges."""
    n = len(centroids)
    seen, huddles = set(), []
    for start in range(n):
        if start in seen:
            continue
        stack, cluster = [start], []
        seen.add(start)
        while stack:
            i = stack.pop()
            cluster.append(i)
            for j in range(n):
                if j not in seen and math.dist(centroids[i], centroids[j]) < body_len_px:
                    seen.add(j)
                    stack.append(j)
        if len(cluster) >= min_birds:
            huddles.append(cluster)
    return huddles


def detect_huddles_complete_linkage(centroids, body_len_px, min_birds=3):
    if body_len_px is None or body_len_px <= 0:
        return []
    groups = [[i] for i in range(len(centroids))]
    while True:
        best = None
        for a in range(len(groups)):
            for b in range(a + 1, len(groups)):
                diameter = max(math.dist(centroids[i], centroids[j]) for i in groups[a] for j in groups[b])
                if diameter < body_len_px:
                    cand = (diameter, a, b)
                    if best is None or cand < best:
                        best = cand
        if best is None:
            break
        _, a, b = best
        groups[a].extend(groups[b])
        del groups[b]
    return [sorted(g) for g in groups if len(g) >= min_birds]


def detect_huddles_average_no_chaining(centroids, body_len_px, min_birds=3):
    """Average-linkage ranking with a hard all-pairs body-length limit (klydel's strict method)."""
    if not body_len_px or body_len_px <= 0:
        return []
    groups = [[i] for i in range(len(centroids))]
    while True:
        best = None
        for a in range(len(groups)):
            for b in range(a + 1, len(groups)):
                distances = [math.dist(centroids[i], centroids[j]) for i in groups[a] for j in groups[b]]
                if max(distances) >= body_len_px:
                    continue
                cand = (sum(distances) / len(distances), a, b)
                if best is None or cand < best:
                    best = cand
        if best is None:
            break
        _, a, b = best
        groups[a].extend(groups[b])
        del groups[b]
    return [sorted(g) for g in groups if len(g) >= min_birds]


def detect_huddles_average_linkage(centroids, body_len_px, min_birds=3):
    """Average linkage WITH chaining (klydel's earlier method): groups merge while their mean distance is under a body."""
    if body_len_px is None or body_len_px <= 0:
        return []
    groups = [[i] for i in range(len(centroids))]
    while True:
        best = None
        for a in range(len(groups)):
            for b in range(a + 1, len(groups)):
                distances = [math.dist(centroids[i], centroids[j]) for i in groups[a] for j in groups[b]]
                mean = sum(distances) / len(distances)
                if mean < body_len_px:
                    cand = (mean, a, b)
                    if best is None or cand < best:
                        best = cand
        if best is None:
            break
        _, a, b = best
        groups[a].extend(groups[b])
        del groups[b]
    return [sorted(g) for g in groups if len(g) >= min_birds]


HUDDLE_METHODS = {
    "connected": detect_huddles,
    "complete": detect_huddles_complete_linkage,
    "average": detect_huddles_average_no_chaining,
    "average_chaining": detect_huddles_average_linkage,
}


def all_pairs_within_body_length(cluster, boxes, body_len_px) -> bool:
    return bool(body_len_px and body_len_px > 0 and
                all(math.dist(boxes[i][:2], boxes[j][:2]) < body_len_px for i, j in combinations(cluster, 2)))


def cluster_rectangle(cluster, boxes):
    """Enclosing (x1, y1, x2, y2) of member boxes given as (cx, cy, w, h)."""
    return (
        min(boxes[i][0] - boxes[i][2] / 2 for i in cluster),
        min(boxes[i][1] - boxes[i][3] / 2 for i in cluster),
        max(boxes[i][0] + boxes[i][2] / 2 for i in cluster),
        max(boxes[i][1] + boxes[i][3] / 2 for i in cluster),
    )


def rectangle_iou(a, b) -> float:
    x1, y1 = max(a[0], b[0]), max(a[1], b[1])
    x2, y2 = min(a[2], b[2]), min(a[3], b[3])
    inter = max(0.0, x2 - x1) * max(0.0, y2 - y1)
    area_a = max(0.0, a[2] - a[0]) * max(0.0, a[3] - a[1])
    area_b = max(0.0, b[2] - b[0]) * max(0.0, b[3] - b[1])
    union = area_a + area_b - inter
    return inter / union if union > 0 else 0.0


def cluster_zone_overlap_fraction(cluster, boxes, zones: Zones) -> float:
    if not cluster or not zones:
        return 0.0
    return zones.covered_fraction(cluster_rectangle(cluster, boxes))


def huddling_indices(centroids, zones: Zones) -> list[int]:
    """Indices of birds whose centre is outside every zone (the ones that can huddle)."""
    if not zones:
        return list(range(len(centroids)))
    return [i for i, (cx, cy) in enumerate(centroids) if not zones.contains(cx, cy)]


def recover_compact_triplets(primary, keep_indices, boxes, body_len_px, zones: Zones, overlap_limit):
    """Second pass on unassigned eligible birds: tight trios (all pairs < 1 body, mean <= 0.75)."""
    if body_len_px is None or body_len_px <= 0:
        return []
    assigned = {i for cluster in primary for i in cluster}
    available = sorted(i for i in keep_indices if i not in assigned)
    if len(available) < 3:
        return []
    primary_rects = [cluster_rectangle(c, boxes) for c in primary]
    candidates = []
    for triple in combinations(available, 3):
        ds = [math.dist(boxes[i][:2], boxes[j][:2]) for i, j in combinations(triple, 2)]
        if max(ds) >= body_len_px or sum(ds) / 3 > 0.75 * body_len_px:
            continue
        if zones and overlap_limit > 0:
            if cluster_zone_overlap_fraction(triple, boxes, zones) >= overlap_limit:
                continue
        rect = cluster_rectangle(triple, boxes)
        if any(rectangle_iou(rect, old) > 0.30 for old in primary_rects):
            continue
        candidates.append((sum(ds) / 3, triple, rect))
    candidates.sort(key=lambda item: (item[0], item[1]))
    added, used, accepted = [], set(), list(primary_rects)
    for _, triple, rect in candidates:
        if any(i in used for i in triple):
            continue
        if any(rectangle_iou(rect, old) > 0.30 for old in accepted):
            continue
        added.append(list(triple))
        used.update(triple)
        accepted.append(rect)
    return added


def filter_clusters(candidate_huddles, overlap_by_cluster, threshold, enable_recovery,
                    keep_indices, boxes, body_len_px, zones: Zones):
    if zones and threshold > 0:
        kept = [c for c in candidate_huddles if overlap_by_cluster[tuple(c)] < threshold]
    else:
        kept = list(candidate_huddles)
    if enable_recovery:
        kept += recover_compact_triplets(kept, keep_indices, boxes, body_len_px, zones, threshold)
    return kept


def temporal_triplet_geometry(track_ids, boxes_by_id, body_length):
    """Edge gap and centre distance of each pair, in body lengths: (max gap, mean gap, max centre, mean centre)."""
    gaps, centers = [], []
    for left, right in combinations(track_ids, 2):
        a, b = boxes_by_id[left], boxes_by_id[right]
        centers.append(math.dist(a[:2], b[:2]) / body_length)
        dx = max(0.0, abs(a[0] - b[0]) - (a[2] + b[2]) / 2)
        dy = max(0.0, abs(a[1] - b[1]) - (a[3] + b[3]) / 2)
        gaps.append(math.hypot(dx, dy) / body_length)
    return max(gaps), sum(gaps) / len(gaps), max(centers), sum(centers) / len(centers)


def temporal_recover_huddles(target, window, zones: Zones):
    """Trios supported by the 2 frames before and after (klydel's two-stage temporal recovery).

    target / window items: {'seq', 't', 'ids', 'boxes', 'body_len', 'keep_indices', 'huddles'}.
    Returns ([(member indices, origin)], audit rows)."""
    primary = [(list(c), "primary") for c in target["huddles"]
               if all_pairs_within_body_length(c, target["boxes"], target["body_len"])]
    audit = []
    if len(window) < 5 or not target["body_len"] or not zones:
        return primary, audit
    if sum(f["seq"] < target["seq"] for f in window) < 2 or sum(f["seq"] > target["seq"] for f in window) < 2:
        return primary, audit

    # klydel matched the 2-decimal precision of its all-frame export; kept for identical results.
    all_boxes = [tuple(round(float(v), 2) for v in box) for box in target["boxes"]]
    mapping = dict(zip(target["ids"], all_boxes))
    length = round(float(target["body_len"]), 2)
    if length <= 0:
        return primary, audit
    eligible = sorted(target["ids"][i] for i in target["keep_indices"])
    index_of = {tid: i for i, tid in enumerate(target["ids"])}
    primary_rects = [cluster_rectangle(c, all_boxes) for c, _ in primary]
    neighbours = []
    for other in window:
        delta = other["seq"] - target["seq"]
        if delta not in (-2, -1, 1, 2):
            continue
        neighbours.append((delta,
                           dict(zip(other["ids"], [tuple(round(float(v), 2) for v in b) for b in other["boxes"]])),
                           round(float(other["body_len"]), 2) if other["body_len"] else 0))
    if len(neighbours) != 4:
        return primary, audit

    candidates = []
    for track_ids in combinations(eligible, 3):
        mg, ag, mc, ac = temporal_triplet_geometry(track_ids, mapping, length)
        if mg > .75 or ag > .40 or mc >= 1.0 or ac > 1.5:
            continue
        indices = [index_of[tid] for tid in track_ids]
        rect = cluster_rectangle(indices, all_boxes)
        zone_fraction = cluster_zone_overlap_fraction(indices, all_boxes, zones)
        if zone_fraction >= .30:
            continue
        old_iou = max((rectangle_iou(rect, old) for old in primary_rects), default=0)
        features = {}
        for delta, box_map, n_len in neighbours:
            if n_len > 0 and all(tid in box_map for tid in track_ids):
                features[delta] = temporal_triplet_geometry(track_ids, box_map, n_len)
        candidates.append((track_ids, indices, rect, mg, ag, mc, ac, zone_fraction, old_iou, features))

    selected = list(primary)
    selected_rects = list(primary_rects)
    used_added: set = set()

    def select_stage(stage, cap, max_gap, avg_gap, max_center, avg_center, neighbour_max_gap, max_new, score_factor):
        scored = []
        for item in candidates:
            tids, indices, rect, mg, ag, mc, ac, z, old_iou, feats = item
            if z >= cap or mg > max_gap or ag > avg_gap or mc > max_center or ac > avg_center:
                continue
            if old_iou > .30 or any(tid in used_added for tid in tids):
                continue
            support = sum(1 for delta, f in feats.items()
                          if abs(delta) <= 2 and f[0] <= neighbour_max_gap and f[2] <= 2.1)
            if support < 4:
                continue
            scored.append(((-support, ag + score_factor * ac, mg, tids), item, support))
        scored.sort(key=lambda v: v[0])
        accepted = 0
        for _, item, support in scored:
            if accepted >= max_new:
                break
            tids, indices, rect, mg, ag, mc, ac, z, old_iou, feats = item
            if any(tid in used_added for tid in tids):
                continue
            if any(rectangle_iou(rect, old) > .30 for old in selected_rects):
                continue
            selected.append((indices, stage))
            selected_rects.append(rect)
            used_added.update(tids)
            accepted += 1
            audit.append([f"{target['t']:.3f}", stage, "|".join(map(str, tids)),
                          round(z, 4), round(mg, 4), round(ag, 4), round(mc, 4), support])

    select_stage("temporal_strict", .15, .25, .18, 1.25, 1.50, .25, 3, .15)
    select_stage("temporal_zero_zone", .03, .35, .20, 1.25, 1.50, .60, 1, .20)
    return selected, audit


# ---------------------------------------------------------------------------
# The whole per-frame pass, for a clip scan
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class BehaviorSettings:
    """klydel's current runner settings (CURRENT_WORKFLOW.md: average, no chaining,
    feeder-aware, local and temporal recovery, overlap 0.30)."""

    window_s: float = 1800.0          # inactivity window
    move_frac: float = 0.5            # allowed wander, in body lengths
    min_fill: float = 0.5             # share of the window's frames a bird must be seen in
    min_huddle: int = 3
    huddle_method: str = "average"
    cluster_zone_overlap: float = 0.30
    local_recovery: bool = True
    temporal_recovery: bool = True

    def validate(self) -> None:
        if self.window_s <= 0 or self.move_frac <= 0 or not 0 < self.min_fill <= 1:
            raise ValueError("window_s and move_frac must be positive and min_fill in (0, 1]")
        if self.min_huddle < 2 or self.huddle_method not in HUDDLE_METHODS:
            raise ValueError("min_huddle must be >= 2 and huddle_method one of " + ", ".join(HUDDLE_METHODS))
        if not 0 <= self.cluster_zone_overlap <= 1:
            raise ValueError("cluster_zone_overlap must be between 0 and 1")
        if self.local_recovery and (self.min_huddle != 3 or self.huddle_method != "average"):
            raise ValueError("local recovery needs min_huddle 3 and the average method")
        if self.temporal_recovery and (not self.local_recovery or abs(self.cluster_zone_overlap - 0.30) > 1e-8):
            raise ValueError("temporal recovery needs local recovery and cluster_zone_overlap 0.30")


@dataclass
class FrameBehavior:
    """What the rules said about one frame. Indices refer to that frame's bird list."""

    huddles: list[tuple[list[int], str]] = field(default_factory=list)   # (members, origin)
    inactive_ids: list[int] = field(default_factory=list)
    feeding: list[int] = field(default_factory=list)                     # indices of birds in a zone


def frame_pass(ids, boxes, body_len, zones: Zones, settings: BehaviorSettings,
               history, t, interval) -> tuple[list[list[int]], list[int], list[int]]:
    """One frame of klydel's linkage runner, before temporal recovery.
    Updates `history`; returns (huddles, inactive ids, keep indices)."""
    for tid, box in zip(ids, boxes):
        history[tid].append((t, box[0], box[1]))
    prune_history(history, t, settings.window_s, interval)
    centroids = [(b[0], b[1]) for b in boxes]
    keep = huddling_indices(centroids, zones)
    huddles, inactive = [], []
    if body_len:
        fn = HUDDLE_METHODS[settings.huddle_method]
        found = fn([centroids[i] for i in keep], body_len, settings.min_huddle)
        candidates = [[keep[i] for i in c] for c in found]
        overlap = {tuple(c): (cluster_zone_overlap_fraction(c, boxes, zones) if zones and settings.cluster_zone_overlap > 0
                              else 0.0) for c in candidates}
        huddles = filter_clusters(candidates, overlap, settings.cluster_zone_overlap, settings.local_recovery,
                                  keep, boxes, body_len, zones)
        huddles = [c for c in huddles if all_pairs_within_body_length(c, boxes, body_len)]
        min_samples = max(1, int(settings.min_fill * settings.window_s / interval))
        inactive = update_inactivity(history, t, settings.window_s, settings.move_frac * body_len, min_samples)
    return huddles, inactive, keep


class BehaviorTracker:
    """Feeds frames through the rules in order. push() returns the frames whose
    answer is final (temporal recovery holds each frame back 2 frames); flush()
    returns the rest at a gap or at the end; reset() starts over after a gap."""

    def __init__(self, settings: BehaviorSettings, zones: Zones, interval: float) -> None:
        settings.validate()
        self.settings = settings
        self.zones = zones
        self.interval = interval
        self.reset()

    def reset(self) -> None:
        self.history = defaultdict(deque)
        self.buffer: deque[dict] = deque()
        self.seq = 0
        self.added = 0

    def push(self, key, ids, boxes, body_len, t, judge: bool = True) -> list[tuple[object, FrameBehavior | None]]:
        """key identifies the frame for the caller. judge=False (a RECOVERING frame) still
        updates the history and serves as temporal context, but gets no answer."""
        huddles, inactive, keep = frame_pass(ids, boxes, body_len, self.zones, self.settings,
                                             self.history, t, self.interval)
        record = {"key": key, "judge": judge, "seq": self.seq, "t": t, "ids": list(ids), "boxes": list(boxes),
                  "body_len": body_len, "keep_indices": keep, "huddles": huddles, "inactive": inactive}
        self.seq += 1
        if not self.settings.temporal_recovery:
            return [(key, self._finish(record, [(c, "primary") for c in huddles]) if judge else None)]
        self.buffer.append(record)
        out = []
        if len(self.buffer) >= 3:
            out.append(self._resolve(self.buffer[-3]))
            if len(self.buffer) > 4:
                self.buffer.popleft()
        return out

    def flush(self) -> list[tuple[object, FrameBehavior | None]]:
        """The last 2 frames, which have no future context: their primary groups only (as klydel does)."""
        if not self.settings.temporal_recovery:
            return []
        pending = list(self.buffer)[-min(self.seq, 2):] if self.seq else []
        out = [self._resolve(r) for r in pending]
        self.buffer.clear()
        return out

    def _resolve(self, record):
        if not record["judge"]:
            return record["key"], None
        clusters, added = temporal_recover_huddles(record, list(self.buffer), self.zones)
        self.added += len(added)
        return record["key"], self._finish(record, clusters)

    def _finish(self, record, clusters) -> FrameBehavior:
        keep = set(record["keep_indices"])
        return FrameBehavior(
            huddles=[(sorted(c), origin) for c, origin in clusters],
            inactive_ids=sorted(record["inactive"]),
            feeding=[i for i in range(len(record["ids"])) if i not in keep],
        )
