"""
live_rules.py: the live monitor's judge, on the same tracker and rules as the laptop's clip scan.

The laptop's "Follow every bird" scan (packages/vision/clip_scan.py) follows the birds with ByteTrack plus klydel's
stable numbers and judges them with klydel's huddling and inactivity rules (github.com/kyaanise1/BehaviorMonitoring,
branch klydel, commit a365f3d). klydel/ holds copies of those three files; test_live_rules.py checks the copies still
match packages/vision when both are on the same computer.

What this adds for a camera that never stops:

  Gaps. A frozen picture (3 near-identical pictures in a row, klydel's gap_guard test) is not looked at: the birds did
  not stand still, the picture did. A jump in time (no picture for LIVE_MAX_GAP_SECONDS, the detector busy with an
  uploaded clip, a restart) starts the birds' numbers and the inactivity clock over, and the next 3 pictures only
  settle the tracker. Both are reported as `gap` in the status.

  How long a huddle lasts. klydel's rules say which birds are huddled in one picture. A huddle counts once the same
  group (half its birds the same, or its outline overlapping by 30 %) has been there for huddle_seconds (10 min), with
  short breaks of up to HUDDLE_BREAK_SECONDS forgiven.

  The interval. Inactivity needs a bird seen in half the pictures of its 30-minute window; "half" is counted from the
  time between pictures as measured, so a slow detector does not make every bird unjudgeable.

The status and the minute rows keep the fields the old engine (behavior.Engine) gave, so the API's alerts
(packages/api/src/behavior-monitor.ts) and behavior_log.py work unchanged.
"""
from __future__ import annotations

import math
import os
import statistics
from collections import deque
from typing import Any, Sequence

import cv2
import numpy as np

import behavior
from klydel.behavior_rules import BehaviorSettings, BehaviorTracker, Zones
from klydel.stable_ids import KLYDEL_COMMIT, REFIND_SECONDS, BroilerTracker, tuned_for

FREEZE_FRAMES = 3          # this many near-identical pictures in a row = a frozen camera (klydel gap_guard)
FREEZE_DIFF = 0.25         # mean grey difference of a 64x48 thumbnail at or below which two pictures are the same
WARMUP_FRAMES = 3          # pictures after a gap that only settle the tracker
HUDDLE_BREAK_SECONDS = float(os.getenv("LIVE_HUDDLE_BREAK_SECONDS", "20"))
MAX_GAP_SECONDS = float(os.getenv("LIVE_MAX_GAP_SECONDS", "0"))   # 0 = max(20 s, 5 pictures)


def signature(frame: np.ndarray | None) -> np.ndarray | None:
    """klydel gap_guard.signature: a coarse grey view without the top and bottom tenth (where clocks are drawn)."""
    if frame is None or not isinstance(frame, np.ndarray) or not frame.size:
        return None
    h = frame.shape[0]
    crop = frame[h // 10: max(h // 10 + 1, 9 * h // 10), :]
    gray = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY) if crop.ndim == 3 else crop
    return cv2.resize(gray, (64, 48), interpolation=cv2.INTER_AREA)


def _rect(boxes: Sequence[Sequence[float]]) -> tuple[float, float, float, float]:
    """Outline (x1, y1, x2, y2) of centre-size boxes."""
    return (min(b[0] - b[2] / 2 for b in boxes), min(b[1] - b[3] / 2 for b in boxes),
            max(b[0] + b[2] / 2 for b in boxes), max(b[1] + b[3] / 2 for b in boxes))


def _rect_iou(a: tuple[float, ...], b: tuple[float, ...]) -> float:
    iw, ih = min(a[2], b[2]) - max(a[0], b[0]), min(a[3], b[3]) - max(a[1], b[1])
    if iw <= 0 or ih <= 0:
        return 0.0
    inter = iw * ih
    return inter / ((a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - inter)


class LiveRules:
    """Feed every picture to check() first; if it says the picture is usable, run the detector and give the boxes to
    update(). `last` and status() then describe the newest judged picture (2 pictures behind, because klydel's
    temporal recovery looks at the 2 pictures on either side)."""

    def __init__(self, inactive_seconds: float = 1800.0, huddle_seconds: float = 600.0, interval: float = 3.0,
                 zones: list | None = None) -> None:
        self.inactive_seconds = float(inactive_seconds)
        self.huddle_seconds = float(huddle_seconds)
        self.interval = float(interval)
        self.max_gap = MAX_GAP_SECONDS or max(20.0, 5 * self.interval)
        self.settings = BehaviorSettings(window_s=self.inactive_seconds)
        self.settings.validate()
        self.zones_norm: list = list(zones or [])
        self.tracker = BroilerTracker(*tuned_for(self.interval))   # a missed bird keeps its number 300 s
        self.rules: BehaviorTracker | None = None   # made at the first picture, once its size is known
        self.last: dict[str, Any] | None = None
        self.gap: dict[str, Any] | None = None       # the latest gap, for the status
        self.restarts = 0
        self._id_base = 0
        self._highest = 0
        self._prev_t: float | None = None
        self._sig: np.ndarray | None = None
        self._repeats = 0
        self._frozen = False
        self._steps: deque[float] = deque(maxlen=50)
        self._seq = 0
        self._reset_state()

    # -- zones ------------------------------------------------------------------------------------------------------
    def set_zones(self, polygons: list) -> None:
        """Feeder and drinker polygons with points in 0..1 (Settings > Feeder zones). Applies from the next picture,
        without starting the birds over."""
        self.zones_norm = list(polygons or [])
        if self.rules is not None and self._size is not None:
            zones = Zones.from_normalized(self.zones_norm, *self._size)
            self.rules.zones = zones
            self.rules.wide_zones = zones.widened(self.settings.feeder_margin_px)

    # -- gaps -------------------------------------------------------------------------------------------------------
    def _reset_state(self) -> None:
        self._warmup = WARMUP_FRAMES
        self._bodies: deque[float] = deque(maxlen=500)
        self._pending: dict[int, tuple[float, list[int], dict[int, tuple], list[bool]]] = {}
        self._still_from: dict[int, float] = {}
        self._huddles: list[dict[str, Any]] = []
        self._size: tuple[int, int] | None = getattr(self, "_size", None)

    def _restart(self, reason: str, t: float) -> None:
        """A gap: the birds' numbers and every clock start over (klydel resets the tracker the same way)."""
        self.tracker.reset()
        if self.rules is not None:
            self.rules.reset()
        self._id_base = self._highest
        self._reset_state()
        self.last = None
        self.restarts += 1
        self.gap = {"reason": reason, "at": t}

    def check(self, t: float, frame: np.ndarray | None) -> str | None:
        """None when the picture is worth looking at, else why not: "frozen_picture" or "bad_frame". A jump in time
        is handled here too (the tracker starts over, and the picture is still looked at)."""
        if self._prev_t is not None and t - self._prev_t > self.max_gap:
            self._restart("time_jump", t)
        if self._prev_t is not None and t > self._prev_t:
            self._steps.append(t - self._prev_t)
        self._prev_t = t
        sig = signature(frame)
        if sig is None:
            return "bad_frame"
        same = self._sig is not None and float(np.mean(cv2.absdiff(self._sig, sig))) <= FREEZE_DIFF
        self._sig = sig
        self._repeats = self._repeats + 1 if same else 0
        if self._repeats >= FREEZE_FRAMES - 1:
            if not self._frozen:
                self._frozen = True
                self._restart("frozen_picture", t)
            return "frozen_picture"
        self._frozen = False
        return None

    def measured_interval(self) -> float:
        return statistics.median(self._steps) if self._steps else self.interval

    # -- one picture ------------------------------------------------------------------------------------------------
    def update(self, t: float, boxes: Sequence[Sequence[float]], width: int, height: int) -> None:
        """boxes: [x, y, w, h, confidence, ...] with x, y the top left corner, every box down to the 0.1 floor."""
        self._size = (int(width), int(height))
        if self.rules is None:
            self.rules = BehaviorTracker(self.settings, Zones.from_normalized(self.zones_norm, width, height),
                                         self.interval)
        self.rules.interval = self.measured_interval()

        dets = [(b[0] + b[2] / 2, b[1] + b[3] / 2, b[2], b[3], float(b[4]) if len(b) > 4 else 1.0) for b in boxes]
        birds = self.tracker.update(dets)
        ids = [self._id_base + b.stable_id for b in birds]
        if ids:
            self._highest = max(self._highest, max(ids))
        by_id = {i: b.box for i, b in zip(ids, birds)}
        if birds:
            self._bodies.append(statistics.median(max(b.box[2], b.box[3]) for b in birds))
        body_len = statistics.median(self._bodies) if self._bodies else None

        judge = self._warmup == 0
        if self._warmup:
            self._warmup -= 1
        seq = self._seq
        self._seq += 1
        answers = self.rules.push(seq, ids, [by_id[i] for i in ids], body_len, t, judge=judge, frame_no=seq,
                                  raw_boxes=[d[:4] for d in dets], raw_scores=[d[4] for d in dets])
        self._pending[seq] = (t, ids, by_id, self._judged(ids, t))
        for key, fb in answers:
            item = self._pending.pop(key, None)
            if item is not None:
                self._settle(*item, fb)
        for key in [k for k in self._pending if k < seq - 5]:
            del self._pending[key]

    def _judged(self, ids: list[int], t: float) -> list[bool]:
        """Per bird: followed for the whole window with enough pictures, so "still" can be said yes or no."""
        min_samples = max(1, int(self.settings.min_fill * self.inactive_seconds / self.rules.interval))
        out = []
        for tid in ids:
            pts = self.rules.history.get(tid)
            out.append(bool(pts) and t - pts[0][0] >= self.inactive_seconds
                       and sum(1 for p in pts if t - p[0] <= self.inactive_seconds) >= min_samples)
        return out

    def _settle(self, t: float, ids: list[int], by_id: dict[int, tuple], judged: list[bool], fb) -> None:
        """The rules' answer for one picture becomes `last`."""
        if fb is None:   # a settling picture after a gap: seen, not judged
            self.last = self._picture(t, ids, [None] * len(ids), [False] * len(ids), None, 0)
            return
        inactive = set(fb.inactive_ids)
        still: list[bool | None] = [True if tid in inactive else (False if ok else None) for tid, ok in zip(ids, judged)]
        for tid, s in zip(ids, still):
            if s is True:
                self._still_from.setdefault(tid, t)
            else:
                self._still_from.pop(tid, None)
        raw_ids = list(fb.raw_added)
        boxes = dict(by_id)
        boxes.update({rid: fb.raw_added[rid][0] for rid in raw_ids})
        all_ids = ids + raw_ids
        huddled, longest = self._follow_huddles(t, [members for members, _ in fb.huddles], boxes)
        in_huddle = [tid in huddled for tid in all_ids]
        self.last = self._picture(t, all_ids, still + [None] * len(raw_ids), in_huddle, longest, len(fb.huddles))
        self.last["feeding"] = len(fb.feeding)

    def _follow_huddles(self, t: float, groups: list[list[int]], boxes: dict[int, tuple]) -> tuple[set[int], float | None]:
        """Joins this picture's huddle groups to the ones already running. Returns the birds in a huddle that has
        lasted huddle_seconds, and how long the longest such huddle has lasted."""
        live = [h for h in self._huddles if t - h["last"] <= max(HUDDLE_BREAK_SECONDS, 3 * self.rules.interval)]
        huddled: set[int] = set()
        longest: float | None = None
        used: set[int] = set()
        for members in groups:
            rect = _rect([boxes[m] for m in members if m in boxes])
            tracked = {m for m in members if m > 0}
            best = None
            for k, h in enumerate(live):
                if k in used:
                    continue
                same = len(tracked & h["members"]) / max(1, min(len(tracked), len(h["members"]))) if tracked else 0.0
                if same >= 0.5 or _rect_iou(rect, h["rect"]) >= 0.3:
                    best = k
                    break
            if best is None:
                live.append({"start": t, "last": t, "members": tracked, "rect": rect})
                best = len(live) - 1
            used.add(best)
            h = live[best]
            h.update(last=t, members=tracked or h["members"], rect=rect)
            lasted = t - h["start"]
            if lasted >= self.huddle_seconds:
                huddled.update(members)
                longest = lasted if longest is None else max(longest, lasted)
        self._huddles = live
        return huddled, longest

    def _picture(self, t: float, ids: list[int], still: list[bool | None], in_huddle: list[bool],
                 huddle_seconds: float | None, groups: int) -> dict[str, Any]:
        """The same fields behavior.Engine.last has, so behavior_log.row and status() read either."""
        known = [s for s in still if s is not None]
        flock_moving = (sum(1 for s in known if not s) / len(known)) if len(known) >= 3 else None
        n = len(ids)
        huddled = sum(1 for h in in_huddle if h)
        fdi = huddled / n if n else 0.0
        return {
            "t": t,
            "n": n,
            "ids": ids,
            "still": still,
            "in_huddle": in_huddle,
            "flock_moving": flock_moving,
            "fdi": fdi,
            "still_seconds": {
                tid: (t - self._still_from[tid] + self.inactive_seconds) if tid in self._still_from else 0.0 for tid in ids
            },
            "huddle": (
                {"birds": huddled, "fdi": round(fdi, 3), "seconds": round(huddle_seconds, 1),
                 "warning": fdi >= behavior.FDI_WARN}
                if huddle_seconds is not None else None
            ),
            "huddle_groups_now": groups,
        }

    # -- what the API asks for --------------------------------------------------------------------------------------
    def status(self, night: bool) -> dict[str, Any]:
        """behavior.Engine.status, from the newest judged picture, plus which rules made it."""
        last = self.last
        extra = {"rules": f"klydel {KLYDEL_COMMIT}", "refind_seconds": REFIND_SECONDS,"zones": len(self.zones_norm), "restarts": self.restarts,
                 "gap": self.gap, "interval_seconds": round(self.measured_interval(), 2)}
        if last is None:
            return {"birds": 0, "night": night, "inactive": [], "flock_inactive": None, "huddle": None, **extra}
        states = [behavior._state(s, h, last["flock_moving"], night) for s, h in zip(last["still"], last["in_huddle"])]
        inactive = [{"id": tid, "still_seconds": round(last["still_seconds"].get(tid, 0.0))}
                    for tid, st in zip(last["ids"], states) if st == behavior.INACTIVE]
        flock = None
        if not night and last["flock_moving"] is not None and last["flock_moving"] < behavior.FLOCK_MOVING_MIN:
            secs = [last["still_seconds"].get(tid, 0.0) for tid, st in zip(last["ids"], states)
                    if st == behavior.FLOCK_INACTIVE]
            if secs:
                flock = {"still_seconds": round(statistics.median(secs))}
        return {"birds": last["n"], "night": night, "inactive": inactive, "flock_inactive": flock,
                "huddle": last["huddle"], **extra}


def valid_zones(value: Any) -> list | None:
    """Polygons of at least 3 [x, y] points in 0..1, at most 50 of them; None when the value is not that."""
    if not isinstance(value, list) or len(value) > 50:
        return None
    out = []
    for poly in value:
        if not isinstance(poly, list) or not 3 <= len(poly) <= 64:
            return None
        pts = []
        for p in poly:
            if (not isinstance(p, (list, tuple)) or len(p) != 2
                    or not all(isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v) for v in p)
                    or not all(0 <= v <= 1 for v in p)):
                return None
            pts.append([float(p[0]), float(p[1])])
        out.append(pts)
    return out
