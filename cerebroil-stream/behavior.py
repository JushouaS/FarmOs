"""
behavior.py: tells which broilers are inactive or huddling, from detection boxes.

Input is what the detector found in a series of frames. Each bird is followed
from frame to frame, then two checks run on the followed birds:

Inactivity
  A bird is "still" when, over the last INACTIVE_SECONDS, it stayed within a
  fraction of its own body size (jitter in the box does not count as movement).
  Broilers rest a lot, so stillness alone is not a problem. A still bird counts
  as INACTIVE only while the rest of the flock is moving; when most of the flock
  is still too, the birds are just RESTING.

Huddling
  Birds that touch or overlap form a group. A group is a huddle when it has
  enough birds, covers its patch of floor much more densely than the flock does
  overall (so a uniformly crowded house is not a huddle), and stays together for
  HUDDLE_SECONDS. FDI is the share of birds that are in a huddle.

The times are short by default so that a short test clip can show both. For a
real house they should be much longer (minutes to an hour); set them with the
BEHAVIOR_* environment variables. Feeder and drinker areas, the time of day
(birds sleep when the lights are off) and the temperature are not considered
here, so treat the result as a flag to look at, not as a diagnosis.
"""
from __future__ import annotations

import math
import os
from statistics import median
from typing import Any

INACTIVE_SECONDS = float(os.getenv("BEHAVIOR_INACTIVE_SECONDS", "10"))
HUDDLE_SECONDS = float(os.getenv("BEHAVIOR_HUDDLE_SECONDS", "6"))
HUDDLE_MIN_BIRDS = int(os.getenv("BEHAVIOR_HUDDLE_MIN_BIRDS", "5"))

MOVE_FRACTION = 0.35        # straying less than this share of its body size = still
FLOCK_MOVING_MIN = 0.2      # an inactive bird needs at least this share of the flock to be moving
HUDDLE_GAP = 0.4            # birds closer than this many body sizes (edge to edge) are in one group
HUDDLE_COVERAGE = 0.5       # a huddle fills at least this share of its own bounding box
HUDDLE_DENSITY_RATIO = 1.5  # ... and is this much denser than the flock as a whole
FDI_WARN = 0.35             # share of the flock in huddles that is worth a warning
MATCH_GATE = 1.0            # a bird moves less than this many body sizes between two frames
MAX_MISSED_SECONDS = 2.0    # a bird the detector misses for longer than this gets a new number

MOVING, RESTING, INACTIVE, HUDDLING = 0, 1, 2, 3


def _iou(a: tuple[float, float, float, float], b: tuple[float, float, float, float]) -> float:
    ax0, ay0, ax1, ay1 = a[0] - a[2] / 2, a[1] - a[3] / 2, a[0] + a[2] / 2, a[1] + a[3] / 2
    bx0, by0, bx1, by1 = b[0] - b[2] / 2, b[1] - b[3] / 2, b[0] + b[2] / 2, b[1] + b[3] / 2
    iw, ih = min(ax1, bx1) - max(ax0, bx0), min(ay1, by1) - max(ay0, by0)
    if iw <= 0 or ih <= 0:
        return 0.0
    inter = iw * ih
    return inter / (a[2] * a[3] + b[2] * b[3] - inter)


class _Track:
    def __init__(self, tid: int, box: tuple[float, float, float, float], t: float) -> None:
        self.id = tid
        self.box = box                       # centre x, centre y, w, h
        self.first_t = self.last_t = t
        self.hist: list[tuple[float, float, float]] = [(t, box[0], box[1])]
        self.sizes: list[float] = [math.sqrt(box[2] * box[3])]
        self.inactive_from: float | None = None
        self.inactive_to: float | None = None

    @property
    def size(self) -> float:
        return median(self.sizes[-20:])

    def update(self, box: tuple[float, float, float, float], t: float) -> None:
        self.box = box
        self.last_t = t
        self.hist.append((t, box[0], box[1]))
        self.sizes.append(math.sqrt(box[2] * box[3]))


def _match(tracks: list[_Track], dets: list[tuple[float, float, float, float]]) -> tuple[dict[int, int], set[int]]:
    """Greedy nearest-first matching of detections to tracks. Returns {det: track} and the unmatched detections."""
    pairs = []
    for ti, trk in enumerate(tracks):
        for di, det in enumerate(dets):
            size = max(trk.size, math.sqrt(det[2] * det[3]))
            d = math.hypot(det[0] - trk.box[0], det[1] - trk.box[1]) / size
            if d <= MATCH_GATE:
                pairs.append((d - 0.5 * _iou(trk.box, det), ti, di))
    pairs.sort()
    used_t: set[int] = set()
    matched: dict[int, int] = {}
    for _, ti, di in pairs:
        if ti in used_t or di in matched:
            continue
        used_t.add(ti)
        matched[di] = ti
    return matched, {di for di in range(len(dets)) if di not in matched}


def _is_still(trk: _Track, t: float, fps: float) -> bool | None:
    """True/False once the bird has been followed for the whole window, else None (too early to say)."""
    if t - trk.first_t < INACTIVE_SECONDS * 0.95:
        return None
    window = [p for p in trk.hist if p[0] >= t - INACTIVE_SECONDS]
    if len(window) < max(3, 0.5 * INACTIVE_SECONDS * fps):
        return None
    mx, my = median(p[1] for p in window), median(p[2] for p in window)
    dists = sorted(math.hypot(p[1] - mx, p[2] - my) for p in window)
    spread = dists[int(0.9 * (len(dists) - 1))]     # ignores a single jumpy frame
    return spread <= MOVE_FRACTION * trk.size


def _groups(items: list[tuple[int, float, float, float, float]]) -> list[list[int]]:
    """Groups of birds whose boxes touch (or nearly), as lists of indexes into items."""
    n = len(items)
    parent = list(range(n))

    def find(i: int) -> int:
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    size = median(math.sqrt(it[3] * it[4]) for it in items)
    for i in range(n):
        for j in range(i + 1, n):
            gx = max(0.0, abs(items[i][1] - items[j][1]) - (items[i][3] + items[j][3]) / 2)
            gy = max(0.0, abs(items[i][2] - items[j][2]) - (items[i][4] + items[j][4]) / 2)
            if math.hypot(gx, gy) <= HUDDLE_GAP * size:
                parent[find(i)] = find(j)
    out: dict[int, list[int]] = {}
    for i in range(n):
        out.setdefault(find(i), []).append(i)
    return list(out.values())


def analyze(frames: list[dict[str, Any]], width: int, height: int) -> dict[str, Any]:
    """Adds [track id, state] to every box of every frame (in place) and returns the summary.

    frames: [{"t": seconds, "boxes": [[x, y, w, h, conf, cls], ...]}, ...] with x, y the top left corner."""
    if not frames:
        return {}
    gaps = [b["t"] - a["t"] for a, b in zip(frames, frames[1:]) if b["t"] > a["t"]]
    fps = 1.0 / median(gaps) if gaps else 1.0
    frame_area = float(width * height)

    tracks: list[_Track] = []      # birds still being followed
    every_track: list[_Track] = [] # every bird ever followed, for the summary
    next_id = 1
    huddles: list[dict[str, Any]] = []
    moving_fractions: list[float] = []
    fdi_peak = 0.0
    fdi_warning = False

    for frame in frames:
        t = frame["t"]
        dets = [(b[0] + b[2] / 2, b[1] + b[3] / 2, b[2], b[3]) for b in frame["boxes"]]
        alive = [trk for trk in tracks if t - trk.last_t <= MAX_MISSED_SECONDS]
        matched, fresh = _match(alive, dets)
        ids: dict[int, _Track] = {}
        for di, ti in matched.items():
            alive[ti].update(dets[di], t)
            ids[di] = alive[ti]
        for di in sorted(fresh):
            trk = _Track(next_id, dets[di], t)
            next_id += 1
            alive.append(trk)
            every_track.append(trk)
            ids[di] = trk
        tracks = alive

        # Who is still, and how much of the flock is moving.
        still: dict[int, bool | None] = {di: _is_still(trk, t, fps) for di, trk in ids.items()}
        known = [s for s in still.values() if s is not None]
        flock_moving = (sum(1 for s in known if not s) / len(known)) if len(known) >= 3 else None
        if flock_moving is not None:
            moving_fractions.append(flock_moving)

        # Huddles: groups of touching birds that are much denser than the flock and stay together.
        in_huddle: set[int] = set()
        if len(dets) >= HUDDLE_MIN_BIRDS:
            items = [(di, d[0], d[1], d[2], d[3]) for di, d in enumerate(dets)]
            global_cov = sum(d[2] * d[3] for d in dets) / frame_area
            for group in _groups(items):
                if len(group) < HUDDLE_MIN_BIRDS:
                    continue
                x0 = min(dets[i][0] - dets[i][2] / 2 for i in group)
                y0 = min(dets[i][1] - dets[i][3] / 2 for i in group)
                x1 = max(dets[i][0] + dets[i][2] / 2 for i in group)
                y1 = max(dets[i][1] + dets[i][3] / 2 for i in group)
                area = max(1.0, (x1 - x0) * (y1 - y0))
                coverage = sum(dets[i][2] * dets[i][3] for i in group) / area
                if coverage < HUDDLE_COVERAGE or coverage < HUDDLE_DENSITY_RATIO * global_cov:
                    continue
                rect = ((x0 + x1) / 2, (y0 + y1) / 2, x1 - x0, y1 - y0)
                best = None
                for h in huddles:
                    if t - h["last"] <= 1.5 and _iou(h["rect"], rect) >= 0.3:
                        best = h
                        break
                if best is None:
                    best = {"start": t, "last": t, "rect": rect, "peak": len(group), "fdi_peak": 0.0}
                    huddles.append(best)
                best["last"], best["rect"] = t, rect
                best["peak"] = max(best["peak"], len(group))
                if t - best["start"] >= HUDDLE_SECONDS:
                    in_huddle.update(group)
                    best["confirmed"] = True
                    best["_now"] = len(group)

        fdi = len(in_huddle) / len(dets) if dets else 0.0
        if in_huddle:
            fdi_peak = max(fdi_peak, fdi)
            fdi_warning = fdi_warning or fdi >= FDI_WARN
            for h in huddles:
                if h.get("confirmed") and t - h["last"] < 1e-9:
                    h["fdi_peak"] = max(h["fdi_peak"], fdi)

        # The state of each bird in this frame.
        for di, box in enumerate(frame["boxes"]):
            trk = ids[di]
            if di in in_huddle:
                state = HUDDLING
            elif still[di]:
                state = INACTIVE if (flock_moving is not None and flock_moving >= FLOCK_MOVING_MIN) else RESTING
            else:
                state = MOVING
            if state == INACTIVE:
                if trk.inactive_from is None:
                    trk.inactive_from = t
                trk.inactive_to = t
            box.extend([trk.id, state])
        frame["fdi"] = round(fdi, 3)

    inactive = [
        {"id": trk.id, "from": round(trk.inactive_from, 2), "to": round(trk.inactive_to or trk.inactive_from, 2)}
        for trk in every_track
        if trk.inactive_from is not None
    ]
    return {
        "birds_followed": next_id - 1,
        "inactive_birds": inactive,
        "huddles": [
            {"start": round(h["start"], 2), "end": round(h["last"], 2), "birds": h["peak"], "fdi": round(h["fdi_peak"], 3)}
            for h in huddles
            if h.get("confirmed")
        ],
        "fdi_peak": round(fdi_peak, 3),
        "fdi_warning": fdi_warning,
        "flock_moving": round(sum(moving_fractions) / len(moving_fractions), 3) if moving_fractions else None,
        "params": {
            "inactive_seconds": INACTIVE_SECONDS,
            "huddle_seconds": HUDDLE_SECONDS,
            "huddle_min_birds": HUDDLE_MIN_BIRDS,
            "fdi_warning": FDI_WARN,
        },
    }

