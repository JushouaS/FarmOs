"""
Huddling and inactivity over tracked birds: klydel's rules.

Ported from github.com/kyaanise1/BehaviorMonitoring, branch klydel, commit
a365f3d (first ported at 9c6f755):
  behavior-pipeline/behavior.py                     (inactivity, body length)
  behavior-pipeline/hybridv2 behavior validation/
      behavior_linkage_test.py                      (linkage clustering)
      behavior_huddling_v2.py                       (feeder zones, contact and strict
                                                     clusters, local and temporal
                                                     recovery, huddling-only detections)
      behavior_inactivity_v2.py, run_behavior_system.py (how a frame is driven)
The logic is theirs, unchanged, apart from one generalisation: a feeder zone
may be a polygon (what Settings > Feeder zones saves) as well as klydel's
axis-aligned rectangles. With rectangles every number is computed exactly as
theirs: fed klydel's own Day 6 bird positions, this module and their
behavior_huddling_v2.py give the same huddle groups on all 1,803 frames, and
1,802 of them match their recorded day6_rawhuddle run (huddling F1 0.83 on their
30 checked frames). tests/test_behavior_rules.py replays part of it.

What changed at a365f3d (huddling only; inactivity is the same):
  - birds inside a feeder zone are no longer dropped from huddling (klydel: the
    zones are broad areas, not outlines of the bowls); only a group whose box
    is 30 % covered by the zones, widened by 15 reference pixels, is dropped;
  - the "contact" method: groups merge by centre distance plus the gap between
    bodies, and the trio recovery asks for touching bodies;
  - a temporal trio may not reuse a bird already in a group;
  - detections the tracker did not output may join huddles (never inactivity).

The steps below describe the 9c6f755 rules; the a365f3d changes above replace
step 1 and refine steps 2 and 4.

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

#: Settings' zones are drawn on whatever the camera gives; a margin in "reference pixels" means pixels of a picture
#: this size, as in klydel's configs/feeding_zones.json.
REFERENCE_SIZE = (1280, 720)


@dataclass(frozen=True)
class Zones:
    """Zones in frame pixels: axis-aligned rectangles (x1, y1, x2, y2) and polygons [(x, y), ...].

    scale: frame pixels per reference pixel (x, y); frame: the frame size, for clamping; grow: how far, in frame
    pixels (x, y), the polygons reach beyond their outline after widened()."""

    rects: tuple[tuple[float, float, float, float], ...] = ()
    polygons: tuple[tuple[tuple[float, float], ...], ...] = ()
    scale: tuple[float, float] = (1.0, 1.0)
    frame: tuple[float, float] = (math.inf, math.inf)
    grow: tuple[float, float] = (0.0, 0.0)

    def __bool__(self) -> bool:
        return bool(self.rects or self.polygons)

    def __len__(self) -> int:
        return len(self.rects) + len(self.polygons)

    @classmethod
    def from_klydel(cls, config: dict, frame_w: float, frame_h: float) -> "Zones":
        """klydel's configs/feeding_zones.json: {"ref_size": [w, h], "zones": [[x1, y1, x2, y2], ...]}."""
        ref_w, ref_h = config["ref_size"]
        sx, sy = frame_w / ref_w, frame_h / ref_h
        return cls(rects=tuple((x1 * sx, y1 * sy, x2 * sx, y2 * sy) for x1, y1, x2, y2 in config["zones"]),
                   scale=(sx, sy), frame=(float(frame_w), float(frame_h)))

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
        return cls(rects=tuple(rects), polygons=tuple(polys),
                   scale=(frame_w / REFERENCE_SIZE[0], frame_h / REFERENCE_SIZE[1]), frame=(float(frame_w), float(frame_h)))

    def widened(self, margin_ref_px: float) -> "Zones":
        """Every zone reaching margin_ref_px reference pixels further, kept inside the picture (klydel's
        expand_feeding_zones): the zones cover the equipment, and the birds feeding beside it as well."""
        if margin_ref_px < 0:
            raise ValueError("the feeder margin must not be negative")
        if not margin_ref_px or not self:
            return self
        mx, my = margin_ref_px * self.scale[0], margin_ref_px * self.scale[1]
        fw, fh = self.frame
        rects = tuple((max(0.0, x1 - mx), max(0.0, y1 - my), min(fw, x2 + mx), min(fh, y2 + my))
                      for x1, y1, x2, y2 in self.rects)
        return Zones(rects, self.polygons, self.scale, self.frame, (self.grow[0] + mx, self.grow[1] + my))

    def contains(self, x: float, y: float) -> bool:
        if any(x1 <= x <= x2 and y1 <= y <= y2 for x1, y1, x2, y2 in self.rects):
            return True
        if not any(self.grow):
            return any(_point_in_polygon(x, y, p) for p in self.polygons)
        return _raster_fraction((x - 0.5, y - 0.5, x + 0.5, y + 0.5), Zones((), self.polygons, grow=self.grow)) > 0

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
    if zones.polygons:
        # A widened polygon: drawn on a canvas reaching `grow` beyond the rectangle, grown by a rectangular
        # kernel (the same shape a widened rectangle has), then cut back to the rectangle.
        gx, gy = (int(math.ceil(g)) for g in zones.grow)
        canvas = np.zeros((h + 2 * gy, w + 2 * gx), np.uint8)
        for poly in zones.polygons:
            pts = np.round(np.array([(px - x1 + gx, py - y1 + gy) for px, py in poly])).astype(np.int32)
            cv2.fillPoly(canvas, [pts], 1)
        if gx or gy:
            canvas = cv2.dilate(canvas, np.ones((2 * gy + 1, 2 * gx + 1), np.uint8))
        mask = np.maximum(mask, canvas[gy:gy + h, gx:gx + w])
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


def silhouette_gap_between(a, b) -> float:
    """Gap between two (cx, cy, w, h) boxes; 0 when they touch or overlap."""
    dx = max(0.0, abs(a[0] - b[0]) - (a[2] + b[2]) / 2)
    dy = max(0.0, abs(a[1] - b[1]) - (a[3] + b[3]) / 2)
    return math.hypot(dx, dy)


def detect_huddles_contact_aware(boxes, body_len_px, min_birds=3):
    """klydel's "contact" grouping (a365f3d): the same hard rule (every pair's centres under one body length),
    but groups are merged in order of centre distance PLUS the gap between the birds' boxes, so birds whose
    bodies touch join each other before birds that are merely close. Takes boxes, not centres."""
    if not body_len_px or body_len_px <= 0:
        return []
    groups = [[i] for i in range(len(boxes))]
    while True:
        best = None
        for a in range(len(groups)):
            for b in range(a + 1, len(groups)):
                centers, gaps = [], []
                for i in groups[a]:
                    for j in groups[b]:
                        centers.append(math.dist(boxes[i][:2], boxes[j][:2]) / body_len_px)
                        gaps.append(silhouette_gap_between(boxes[i], boxes[j]) / body_len_px)
                if max(centers) >= 1.0:
                    continue
                cand = ((sum(centers) + sum(gaps)) / len(centers), a, b)
                if best is None or cand < best:
                    best = cand
        if best is None:
            break
        _, a, b = best
        groups[a].extend(groups[b])
        del groups[b]
    return [sorted(g) for g in groups if len(g) >= min_birds]


#: Methods that group by centres. "contact" groups by boxes (detect_huddles_contact_aware).
HUDDLE_METHODS = {
    "connected": detect_huddles,
    "complete": detect_huddles_complete_linkage,
    "average": detect_huddles_average_no_chaining,
    "average_chaining": detect_huddles_average_linkage,
}
METHODS = (*HUDDLE_METHODS, "contact")


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


def recover_contact_triplets(primary, keep_indices, boxes, body_len_px, zones: Zones, overlap_limit):
    """klydel's contact trio recovery (a365f3d): leftover trios with every pair under one body length, mean
    under 0.90, AND bodies touching (every box gap and the mean gap at most 0.10 body)."""
    if not body_len_px or body_len_px <= 0:
        return []
    assigned = {i for cluster in primary for i in cluster}
    available = sorted(i for i in keep_indices if i not in assigned)
    if len(available) < 3:
        return []
    existing = [cluster_rectangle(g, boxes) for g in primary]
    candidates = []
    for triple in combinations(available, 3):
        centers = [math.dist(boxes[i][:2], boxes[j][:2]) / body_len_px for i, j in combinations(triple, 2)]
        if max(centers) >= 1.0 or sum(centers) / 3 > 0.90:
            continue
        gaps = [silhouette_gap_between(boxes[i], boxes[j]) / body_len_px for i, j in combinations(triple, 2)]
        if max(gaps) > 0.10 or sum(gaps) / 3 > 0.10:
            continue
        if zones and overlap_limit > 0:
            if cluster_zone_overlap_fraction(triple, boxes, zones) >= overlap_limit:
                continue
        rect = cluster_rectangle(triple, boxes)
        if any(rectangle_iou(rect, old) > 0.30 for old in existing):
            continue
        candidates.append((max(gaps), sum(gaps), sum(centers), triple, rect))
    candidates.sort()
    out, used, accepted = [], set(), list(existing)
    for *_, triple, rect in candidates:
        if any(i in used for i in triple):
            continue
        if any(rectangle_iou(rect, old) > 0.30 for old in accepted):
            continue
        out.append(list(triple))
        used.update(triple)
        accepted.append(rect)
    return out


def filter_clusters(candidate_huddles, overlap_by_cluster, threshold, enable_recovery,
                    keep_indices, boxes, body_len_px, zones: Zones, contact_aware: bool = False):
    if zones and threshold > 0:
        kept = [c for c in candidate_huddles if overlap_by_cluster[tuple(c)] < threshold]
    else:
        kept = list(candidate_huddles)
    if enable_recovery:
        recover = recover_contact_triplets if contact_aware else recover_compact_triplets
        kept += recover(kept, keep_indices, boxes, body_len_px, zones, threshold)
    return kept


def augment_with_untracked(ids, boxes, raw_boxes, raw_scores, body_len, frame_no,
                           min_conf=0.30, max_duplicate_iou=0.40, max_neighbor_lengths=1.5):
    """klydel's huddling-only detection recovery (a365f3d HuddlingModule.augment_with_untracked_yolo).

    A detection the tracker did not output (score >= min_conf, not overlapping a box already there by IoU
    max_duplicate_iou, within max_neighbor_lengths body lengths of a tracked bird) is added FOR HUDDLING ONLY,
    under a frame-local negative number -(frame_no x 1000 + k + 1). It never enters the inactivity history and is
    not a track. Returns (ids, boxes, {added id: score})."""
    out_ids, out_boxes, added = list(ids), list(boxes), {}
    if not body_len or not boxes:
        return out_ids, out_boxes, added
    tracked = list(boxes)
    for k, (raw_box, score) in enumerate(zip(raw_boxes, raw_scores)):
        if score < min_conf:
            continue
        cand = tuple(float(v) for v in raw_box)
        rect = cluster_rectangle([0], [cand])
        if any(rectangle_iou(rect, cluster_rectangle([0], [old])) >= max_duplicate_iou for old in out_boxes):
            continue
        if min(math.dist(cand[:2], old[:2]) for old in tracked) > max_neighbor_lengths * body_len:
            continue
        local_id = -(int(frame_no) * 1000 + k + 1)
        out_ids.append(local_id)
        out_boxes.append(cand)
        added[local_id] = float(score)
    return out_ids, out_boxes, added


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
    primary_members = {i for group, _origin in primary for i in group}   # a365f3d: no bird in two groups at once
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
        if any(index in primary_members for index in indices):
            continue
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
    """The settings of klydel's best Day 6 huddling run (a365f3d, day6_rawhuddle: F1 0.83 on 30 frames):
    run_behavior_system.py --huddle-method contact --cluster-zone-overlap 0.30 --local-recovery
    --temporal-recovery --huddle-raw-recovery, feeder margin 15 px, no hard feeder exclusion. Inactivity:
    behavior.py's defaults (30 min, half a body length, seen in half the window)."""

    window_s: float = 1800.0            # inactivity window
    move_frac: float = 0.5              # allowed wander, in body lengths
    min_fill: float = 0.5               # share of the window's frames a bird must be seen in
    min_huddle: int = 3
    huddle_method: str = "contact"
    cluster_zone_overlap: float = 0.30
    local_recovery: bool = True
    temporal_recovery: bool = True
    feeder_margin_px: float = 15.0      # zones widened by this many reference pixels for the overlap rule
    hard_feeder_exclusion: bool = False # klydel's older rule: a bird inside a (widened) zone can never huddle
    huddle_raw_recovery: bool = True    # detections the tracker missed count for huddling (never inactivity)

    def validate(self) -> None:
        if self.window_s <= 0 or self.move_frac <= 0 or not 0 < self.min_fill <= 1:
            raise ValueError("window_s and move_frac must be positive and min_fill in (0, 1]")
        if self.min_huddle < 2 or self.huddle_method not in METHODS:
            raise ValueError("min_huddle must be >= 2 and huddle_method one of " + ", ".join(METHODS))
        if not 0 <= self.cluster_zone_overlap <= 1:
            raise ValueError("cluster_zone_overlap must be between 0 and 1")
        if self.feeder_margin_px < 0:
            raise ValueError("feeder_margin_px must not be negative")
        if self.local_recovery and (self.min_huddle != 3 or self.huddle_method not in ("average", "contact")):
            raise ValueError("local recovery needs min_huddle 3 and the average or contact method")
        if self.temporal_recovery and (not self.local_recovery or abs(self.cluster_zone_overlap - 0.30) > 1e-8):
            raise ValueError("temporal recovery needs local recovery and cluster_zone_overlap 0.30")


@dataclass
class FrameBehavior:
    """What the rules said about one frame, by bird number. Huddle members may include huddle-only
    detections (negative numbers, see augment_with_untracked); raw_added holds their boxes and scores."""

    huddles: list[tuple[list[int], str]] = field(default_factory=list)   # (bird numbers, origin)
    inactive_ids: list[int] = field(default_factory=list)
    feeding: list[int] = field(default_factory=list)                     # numbers of birds inside a zone (as drawn)
    raw_added: dict[int, tuple[tuple[float, float, float, float], float]] = field(default_factory=dict)


def frame_pass(ids, boxes, body_len, zones: Zones, settings: BehaviorSettings, history, t, interval,
               frame_no: int = 0, raw_boxes=None, raw_scores=None, wide_zones: Zones | None = None) -> dict:
    """One frame of klydel's run_behavior_system.py (a365f3d), before temporal recovery. Updates `history`.

    Inactivity sees only the tracked birds. Huddling sees them plus, with huddle_raw_recovery, the detections
    the tracker missed. `zones` are the zones as drawn (used to count birds at a feeder); `wide_zones` are the
    same widened by the feeder margin (used for the overlap rule)."""
    wide = wide_zones if wide_zones is not None else zones.widened(settings.feeder_margin_px)
    for tid, box in zip(ids, boxes):
        history[tid].append((t, box[0], box[1]))
    prune_history(history, t, settings.window_s, interval)
    inactive = []
    if body_len:
        min_samples = max(1, int(settings.min_fill * settings.window_s / interval))
        inactive = update_inactivity(history, t, settings.window_s, settings.move_frac * body_len, min_samples)

    h_ids, h_boxes, raw_added = list(ids), [tuple(b) for b in boxes], {}
    if settings.huddle_raw_recovery and raw_boxes is not None:
        h_ids, h_boxes, raw_added = augment_with_untracked(ids, h_boxes, raw_boxes, raw_scores, body_len, frame_no)
    centroids = [(b[0], b[1]) for b in h_boxes]
    feeding = [h_ids[i] for i in range(len(h_ids)) if i not in set(huddling_indices(centroids, zones))]
    keep = huddling_indices(centroids, wide) if settings.hard_feeder_exclusion else list(range(len(h_ids)))
    huddles = []
    if body_len:
        if settings.huddle_method == "contact":
            found = detect_huddles_contact_aware([h_boxes[i] for i in keep], body_len, settings.min_huddle)
        else:
            found = HUDDLE_METHODS[settings.huddle_method]([centroids[i] for i in keep], body_len, settings.min_huddle)
        candidates = [[keep[i] for i in c] for c in found]
        overlap = {tuple(c): (cluster_zone_overlap_fraction(c, h_boxes, wide) if wide and settings.cluster_zone_overlap > 0
                              else 0.0) for c in candidates}
        huddles = filter_clusters(candidates, overlap, settings.cluster_zone_overlap, settings.local_recovery,
                                  keep, h_boxes, body_len, wide, contact_aware=settings.huddle_method == "contact")
        huddles = [c for c in huddles if all_pairs_within_body_length(c, h_boxes, body_len)]
    return {"ids": h_ids, "boxes": h_boxes, "raw_added": raw_added, "keep_indices": keep,
            "feeding": feeding, "huddles": huddles, "inactive": inactive}


class BehaviorTracker:
    """Feeds frames through the rules in order. push() returns the frames whose
    answer is final (temporal recovery holds each frame back 2 frames); flush()
    returns the rest at a gap or at the end; reset() starts over after a gap."""

    def __init__(self, settings: BehaviorSettings, zones: Zones, interval: float) -> None:
        settings.validate()
        self.settings = settings
        self.zones = zones
        self.wide_zones = zones.widened(settings.feeder_margin_px)
        self.interval = interval
        self.reset()

    def reset(self) -> None:
        self.history = defaultdict(deque)
        self.buffer: deque[dict] = deque()
        self.seq = 0
        self.added = 0

    def push(self, key, ids, boxes, body_len, t, judge: bool = True, frame_no: int = 0,
             raw_boxes=None, raw_scores=None) -> list[tuple[object, FrameBehavior | None]]:
        """key identifies the frame for the caller. judge=False (a RECOVERING frame) still updates the history and
        serves as temporal context, but gets no answer. raw_boxes/raw_scores: every detection of the frame, for the
        huddling-only recovery; frame_no makes their numbers unique."""
        p = frame_pass(ids, boxes, body_len, self.zones, self.settings, self.history, t, self.interval,
                       frame_no=frame_no, raw_boxes=raw_boxes, raw_scores=raw_scores, wide_zones=self.wide_zones)
        record = {"key": key, "judge": judge, "seq": self.seq, "t": t, "body_len": body_len, **p}
        self.seq += 1
        if not self.settings.temporal_recovery:
            return [(key, self._finish(record, [(c, "primary") for c in p["huddles"]]) if judge else None)]
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
        clusters, added = temporal_recover_huddles(record, list(self.buffer), self.wide_zones)
        self.added += len(added)
        return record["key"], self._finish(record, clusters)

    def _finish(self, record, clusters) -> FrameBehavior:
        ids, boxes = record["ids"], record["boxes"]
        return FrameBehavior(
            huddles=[(sorted(ids[i] for i in c), origin) for c, origin in clusters],
            inactive_ids=sorted(record["inactive"]),
            feeding=list(record["feeding"]),
            raw_added={rid: (tuple(boxes[ids.index(rid)]), score) for rid, score in record["raw_added"].items()},
        )
