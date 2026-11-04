"""
Behaviour measurements for broiler detection boxes.

Everything here is a pure function over numbers: no camera, no model, no
database. That is deliberate — this is the part of the pipeline whose
thresholds get argued about, so it has to be testable without a chicken in
front of a lens.

The two behaviours this reports:

  Inactivity  — a bird that did not move between two frames a fraction of a
                second apart. Measured per box from the pixels inside it, not
                from whole-frame motion, because whole-frame motion cannot
                tell a moving bird from a shaking camera.
  Huddling    — birds packed together tightly enough to be touching, measured
                as neighbours within a radius scaled to bird size. Birds
                standing in a marked feeder zone are excluded: crowding at a
                feeder is feeding, not a welfare signal. They stay in the
                inactivity count, though, because a motionless bird at a
                feeder can still be unwell.

Vocabulary note: labels and statuses match what the API and dashboard already
speak ("none"/"mild"/"moderate"/"severe", "nominal"/"warning"/"critical"), so
nothing downstream has to learn new words.
"""

from dataclasses import dataclass, field

import numpy as np

# ---------------------------------------------------------------------------
# Defaults. Every one of these is exposed as an environment variable in
# app.py; they are defaults, not laws of nature. Calibrate against real
# footage before trusting the numbers.
# ---------------------------------------------------------------------------

#: Share of a box's width/height ignored at the edges. Box corners jitter a
#: few pixels between frames, and since the diff is measured inside the box,
#: that jitter would otherwise read as the bird moving.
BOX_INSET = 0.15

#: Mean absolute pixel change (0..1) that counts as movement.
MOTION_THRESHOLD = 0.004

#: Neighbour radius as a multiple of the median bird width. Birds touching
#: each other sit about one body-width apart.
RADIUS_FACTOR = 1.3

#: Neighbours needed before a bird counts as part of a clump. Four neighbours
#: means five birds, which is a clump rather than two birds standing near
#: each other.
MIN_NEIGHBOURS = 4

#: Smallest group that is worth calling a huddle.
MIN_CLUSTER = 5


@dataclass
class Box:
    """A detection, in pixels, plus whatever the detector knew about it."""

    x: float
    y: float
    w: float
    h: float
    confidence: float = 1.0

    @property
    def centre(self) -> tuple[float, float]:
        return self.x + self.w / 2.0, self.y + self.h / 2.0

    @property
    def foot(self) -> tuple[float, float]:
        """Where the bird meets the floor. For an angled view this is the
        point that actually sits over a feeder; for a straight overhead view
        the centre is correct instead."""
        return self.x + self.w / 2.0, self.y + self.h


@dataclass
class HuddleResult:
    """What the spatial pass found."""

    huddled: list[bool] = field(default_factory=list)
    clusters: list[list[int]] = field(default_factory=list)
    risk: float = 0.0
    coverage: float = 0.0
    compactness: float = 0.0
    radius: float = 0.0


# ---------------------------------------------------------------------------
# Zones (manual feeder / drinker polygons)
# ---------------------------------------------------------------------------

def point_in_polygon(x: float, y: float, polygon: list[list[float]]) -> bool:
    """
    Ray casting: count how many polygon edges a ray from the point crosses.

    Coordinates are normalised (0..1), so this is resolution-independent. A
    point exactly on an edge is not specified — it may land either way, which
    does not matter when the polygon is 200 px wide.
    """
    n = len(polygon)
    if n < 3:
        return False

    inside = False
    j = n - 1
    for i in range(n):
        xi, yi = polygon[i][0], polygon[i][1]
        xj, yj = polygon[j][0], polygon[j][1]
        # Does the edge straddle the horizontal line through the point?
        if (yi > y) != (yj > y):
            crossing_x = (xj - xi) * (y - yi) / (yj - yi) + xi
            if x < crossing_x:
                inside = not inside
        j = i
    return inside


def zone_mask(
    boxes: list[Box],
    zones: list[list[list[float]]],
    frame_w: int,
    frame_h: int,
    anchor: str = "centre",
) -> list[bool]:
    """
    Which boxes are standing in a feeder/drinker zone.

    `zones` is a list of normalised polygons. `anchor` picks the point that
    gets tested: "centre" for an overhead camera, "foot" for an angled one.
    """
    if not zones or frame_w <= 0 or frame_h <= 0:
        return [False] * len(boxes)

    mask: list[bool] = []
    for b in boxes:
        px, py = b.centre if anchor == "centre" else b.foot
        nx, ny = px / frame_w, py / frame_h
        mask.append(any(point_in_polygon(nx, ny, poly) for poly in zones))
    return mask


# ---------------------------------------------------------------------------
# Inactivity
# ---------------------------------------------------------------------------

def box_motions(prev_gray: np.ndarray, now_gray: np.ndarray, boxes: list[Box],
                inset: float = BOX_INSET) -> list[float]:
    """
    Mean absolute pixel change inside each box, as a share of full scale.

    The frame pair is expected to be shift-corrected already (see
    detector.estimate_shift) so camera shake is not mistaken for birds moving.
    """
    if prev_gray.shape != now_gray.shape or not boxes:
        return [0.0] * len(boxes)

    h, w = now_gray.shape[:2]
    out: list[float] = []

    for b in boxes:
        dx, dy = b.w * inset, b.h * inset
        x0 = int(max(0, b.x + dx))
        y0 = int(max(0, b.y + dy))
        x1 = int(min(w, b.x + b.w - dx))
        y1 = int(min(h, b.y + b.h - dy))
        if x1 - x0 < 3 or y1 - y0 < 3:
            # Too small to hold a sample worth taking. Claim no motion rather
            # than inventing some out of two pixels of sensor noise.
            out.append(0.0)
            continue
        diff = np.abs(
            now_gray[y0:y1, x0:x1].astype(np.int16)
            - prev_gray[y0:y1, x0:x1].astype(np.int16)
        )
        out.append(float(diff.mean()) / 255.0)
    return out


def count_inactive(motions: list[float], threshold: float = MOTION_THRESHOLD) -> int:
    """Birds whose pixels barely changed between the two frames."""
    return sum(1 for m in motions if m < threshold)


# ---------------------------------------------------------------------------
# Huddling
# ---------------------------------------------------------------------------

def cluster_huddling(
    boxes: list[Box],
    radius_factor: float = RADIUS_FACTOR,
    min_neighbours: int = MIN_NEIGHBOURS,
    min_cluster: int = MIN_CLUSTER,
) -> HuddleResult:
    """
    Group birds that are packed tightly enough to be huddling.

    The radius comes from the median box width rather than a fixed number of
    pixels, so the test still means the same thing as the birds grow and as
    the camera's field of view changes.

    A bird counts as huddled when it has at least `min_neighbours` other birds
    within that radius. Qualified birds are then joined into clusters through
    their shared neighbours, and only clusters of at least `min_cluster` birds
    are kept — two birds standing close together is not a huddle.
    """
    n = len(boxes)
    if n < min_cluster:
        return HuddleResult(huddled=[False] * n)

    widths = np.array([b.w for b in boxes], dtype=float)
    median_w = float(np.median(widths))
    if median_w <= 0:
        return HuddleResult(huddled=[False] * n)

    radius = median_w * radius_factor
    centres = np.array([b.centre for b in boxes], dtype=float)

    # Neighbour counts. n is small (tens, not thousands), so the plain
    # all-pairs distance matrix is the clearest way to do this.
    delta = centres[:, None, :] - centres[None, :, :]
    dist = np.sqrt((delta ** 2).sum(axis=2))
    within = (dist <= radius) & ~np.eye(n, dtype=bool)
    neighbour_count = within.sum(axis=1)

    qualified = neighbour_count >= min_neighbours
    if not qualified.any():
        return HuddleResult(huddled=[False] * n, radius=round(radius, 1))

    # Union-find over the neighbour graph, restricted to qualified birds, so a
    # clump is one cluster even when its edges are not all mutually within
    # reach.
    parent = list(range(n))

    def find(i: int) -> int:
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    def union(a: int, b: int) -> None:
        ra, rb = find(a), find(b)
        if ra != rb:
            parent[rb] = ra

    for i in range(n):
        if not qualified[i]:
            continue
        for j in range(n):
            if i != j and qualified[j] and within[i, j]:
                union(i, j)

    groups: dict[int, list[int]] = {}
    for i in range(n):
        if qualified[i]:
            groups.setdefault(find(i), []).append(i)

    huddled = [False] * n
    clusters: list[list[int]] = []
    for members in groups.values():
        if len(members) < min_cluster:
            continue
        clusters.append(members)
        for i in members:
            huddled[i] = True

    evaluable = n
    coverage = sum(huddled) / evaluable if evaluable else 0.0
    compactness = _compactness(boxes, clusters, median_w)
    risk = round(min(1.0, 0.7 * coverage + 0.3 * compactness), 4)

    return HuddleResult(
        huddled=huddled,
        clusters=clusters,
        risk=risk,
        coverage=round(coverage, 4),
        compactness=round(compactness, 4),
        radius=round(radius, 1),
    )


def _compactness(boxes: list[Box], clusters: list[list[int]], median_w: float) -> float:
    """
    How tightly the clusters are packed, 0..1.

    Compares the floor area a cluster occupies with the area its birds would
    cover if they were standing shoulder to shoulder. 1 means they tile the
    space they occupy (very tight), low means they are spread out.
    """
    if not clusters or median_w <= 0:
        return 0.0

    scores: list[float] = []
    for members in clusters:
        xs = [boxes[i].x for i in members]
        ys = [boxes[i].y for i in members]
        xe = [boxes[i].x + boxes[i].w for i in members]
        ye = [boxes[i].y + boxes[i].h for i in members]
        area = max(1.0, (max(xe) - min(xs)) * (max(ye) - min(ys)))
        # Body footprint assumed roughly square at the median box width.
        filled = len(members) * median_w * median_w
        scores.append(min(1.0, filled / area))
    return float(np.mean(scores))
