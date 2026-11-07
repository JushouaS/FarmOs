"""
Tracked scan of an uploaded clip: every bird followed from start to end.

The older Test clip check looks at 30 separate moments and forgets each one;
nothing links a bird in one moment to the same bird in the next. This reads
the clip continuously instead, the way klydel's gap-aware runner does
(behavior-pipeline/hybridv2 behavior validation/run_pipeline_hybrid_v2_gapaware.py,
commit 9c6f755):

  1. One frame every `interval` seconds of video time (2 s by default).
  2. The gap guard labels each frame VALID or GAP (frozen, skipped,
     unreadable, or excluded by the operator).
  3. After a gap, the tracker is reset, so it cannot join birds across time it
     never saw, and the next `warmup_frames` frames are RECOVERING: tracked,
     but not yet trusted for behaviour.
  4. A frame with fewer than `min_visible` tracked birds is also a GAP
     (too_few_tracked_birds), and resets the tracker the same way.
  5. Each frame's detections go to BroilerTracker (ByteTrack + klydel's stable
     IDs and recovery). The detector runs at a 0.1 floor and NMS IoU 0.7, the
     settings klydel's runs get from Ultralytics; the live camera's 0.35 floor
     would starve ByteTrack's low-score step.

Bird numbers restart with every tracker reset, so each reset starts a new
"session" and the numbers shown are made unique across the clip (session 2's
bird 1 is shown as one more than the highest number used before).

  6. Each VALID frame is judged by klydel's huddling and inactivity rules
     (behavior_rules.py): strict huddle groups outside the feeder zones, and
     birds that stayed within half a body length for the inactivity window.
     A frame's answer is final 2 frames later (temporal recovery looks ahead),
     and a gap ends every inactivity window. GAP and RECOVERING frames get no
     behaviour: unknown, not "nothing happening".

The feeder zones are the ones saved for VIDEO_ZONE_CAMERA in Settings, unless
the request sends its own. A scan only reads the clip and writes nothing to
the database.
"""
from __future__ import annotations

import csv
import io
import logging
import statistics
import threading
import time
import uuid
from collections import deque
from dataclasses import asdict, dataclass, field
from typing import Callable, Iterator

import cv2
import numpy as np

from behavior_rules import BehaviorSettings, BehaviorTracker, Zones
from bytetrack import ByteTrackConfig, _env_float
from gap_guard import iter_guarded_samples, parse_exclusions
from stable_ids import KLYDEL_COMMIT, BroilerTracker, HybridConfig

logger = logging.getLogger(__name__)

VALID, GAP, RECOVERING = "VALID", "GAP", "RECOVERING"


@dataclass(frozen=True)
class ScanSettings:
    interval: float = 2.0         # seconds of video between sampled frames
    conf: float = 0.1             # detector floor for tracking
    nms_iou: float = 0.7          # detector NMS overlap for tracking (Ultralytics' default)
    freeze_frames: int = 3        # near-identical samples in a row = frozen recording
    freeze_diff: float = 0.25     # mean grey difference (0..255) that still counts as identical
    max_time_step: float = 6.0    # seconds between samples beyond which time was skipped
    warmup_frames: int = 3        # RECOVERING frames after a reset
    min_visible: int = 1          # fewer tracked birds than this = GAP
    exclusions: tuple[tuple[float, float], ...] = ()
    inactivity_window_s: float = 1800.0   # klydel / thesis: 30 minutes
    move_frac: float = 0.5                # allowed wander, in body lengths
    min_fill: float = 0.5                 # share of the window's frames a bird must be seen in

    @classmethod
    def from_env(cls) -> "ScanSettings":
        d = cls()
        return cls(
            interval=_env_float("TRACK_INTERVAL_S", d.interval),
            conf=_env_float("TRACK_CONF_MIN", d.conf),
            nms_iou=_env_float("TRACK_NMS_IOU", d.nms_iou),
            freeze_frames=int(_env_float("TRACK_FREEZE_FRAMES", d.freeze_frames)),
            freeze_diff=_env_float("TRACK_FREEZE_DIFF", d.freeze_diff),
            max_time_step=_env_float("TRACK_MAX_TIME_STEP_S", d.max_time_step),
            warmup_frames=int(_env_float("TRACK_WARMUP_FRAMES", d.warmup_frames)),
            min_visible=int(_env_float("TRACK_MIN_VISIBLE", d.min_visible)),
            inactivity_window_s=_env_float("TRACK_INACTIVITY_WINDOW_S", d.inactivity_window_s),
            move_frac=_env_float("TRACK_MOVE_FRAC", d.move_frac),
            min_fill=_env_float("TRACK_MIN_FILL", d.min_fill),
        )

    def with_overrides(self, interval: float | None = None, exclude: list[str] | None = None,
                       inactivity_window_s: float | None = None) -> "ScanSettings":
        """A copy with what the operator chose for this clip. Raises ValueError on bad input."""
        changes: dict = {}
        if interval is not None:
            changes["interval"] = float(interval)
        if exclude:
            changes["exclusions"] = tuple(parse_exclusions(exclude))
        if inactivity_window_s is not None:
            changes["inactivity_window_s"] = float(inactivity_window_s)
        out = ScanSettings(**{**asdict(self), **changes})
        out.validate()
        return out

    def behavior(self) -> BehaviorSettings:
        return BehaviorSettings(window_s=self.inactivity_window_s, move_frac=self.move_frac, min_fill=self.min_fill)

    def validate(self) -> None:
        if not 0.2 <= self.interval <= 60:
            raise ValueError("interval must be between 0.2 and 60 seconds")
        if self.freeze_frames < 2:
            raise ValueError("freeze_frames must be at least 2")
        if self.max_time_step <= self.interval:
            raise ValueError("max_time_step must be longer than the interval")
        if self.warmup_frames < 0 or self.min_visible < 0:
            raise ValueError("warmup_frames and min_visible must not be negative")
        if not 0 < self.conf < 1 or not 0 < self.nms_iou <= 1:
            raise ValueError("conf must be in (0, 1) and nms_iou in (0, 1]")
        if not 10 <= self.inactivity_window_s <= 4 * 3600:
            raise ValueError("inactivity_window_s must be between 10 seconds and 4 hours")
        if self.inactivity_window_s < 3 * self.interval:
            raise ValueError("inactivity_window_s must cover at least 3 sampled frames")
        self.behavior().validate()


@dataclass
class TrackedBird:
    id: int                       # unique across the clip
    cx: float
    cy: float
    w: float
    h: float
    score: float
    recovered: bool

    def as_list(self) -> list:
        return [self.id, round(self.cx, 1), round(self.cy, 1), round(self.w, 1), round(self.h, 1),
                round(self.score, 3), int(self.recovered)]


@dataclass
class ScanSample:
    t: float
    frame_no: int | None
    status: str
    reason: str = ""
    session: int = 0
    n_detections: int = 0
    body_len: float | None = None
    birds: list[TrackedBird] = field(default_factory=list)
    # Behaviour, VALID frames only (None = not judged: GAP, RECOVERING).
    huddles: list[tuple[list[int], str]] | None = None    # (bird ids, origin: primary / temporal_*)
    inactive: list[int] | None = None                     # bird ids
    feeding: int | None = None                            # birds in a feeder/drinker zone

    @property
    def recovered(self) -> int:
        return sum(1 for b in self.birds if b.recovered)

    @property
    def judged(self) -> bool:
        return self.huddles is not None

    def as_dict(self, with_birds: bool = True) -> dict:
        out = {
            "t": round(self.t, 3),
            "frame_no": self.frame_no,
            "status": self.status,
            "reason": self.reason,
            "session": self.session,
            "n_birds": len(self.birds) if self.status != GAP else None,
            "n_detections": self.n_detections if self.status != GAP else None,
            "body_len_px": round(self.body_len, 2) if self.body_len else None,
            "recovered": self.recovered if self.status != GAP else None,
            "huddles": [{"birds": ids, "origin": origin} for ids, origin in self.huddles] if self.judged else None,
            "inactive": self.inactive,
            "feeding": self.feeding,
        }
        if with_birds:
            # [id, cx, cy, w, h, score, recovered]: compact, a 1 h clip is ~1800 of these.
            out["birds"] = [b.as_list() for b in self.birds]
        return out


def sample_frames(path: str, interval: float) -> Iterator[tuple[float, int, np.ndarray]]:
    """(video time in s, sample number from 1, frame), one every `interval` s;
    times are frame index / fps, as in klydel's common.sample_frames."""
    cap = cv2.VideoCapture(path)
    if not cap.isOpened():
        raise RuntimeError("the clip could not be opened")
    fps = cap.get(cv2.CAP_PROP_FPS)
    if fps <= 0:
        cap.release()
        raise RuntimeError("the clip has no frame rate")
    step = max(1, round(fps * interval))
    i = n = 0
    try:
        while cap.grab():
            if i % step == 0:
                ok, frame = cap.retrieve()
                n += 1
                yield i / fps, n, (frame if ok else None)
            i += 1
    finally:
        cap.release()


Detect = Callable[[np.ndarray], list[tuple[float, float, float, float, float]]]


def scan(
    frames,
    detect: Detect,
    settings: ScanSettings,
    tracker: BroilerTracker | None = None,
    cancel: threading.Event | None = None,
    zones: list | None = None,
    stats: dict | None = None,
) -> Iterator[ScanSample]:
    """Yields one ScanSample per sampled frame (and per detected time jump), in time order.

    frames: (t, n, image) in time order. detect: image -> (cx, cy, w, h, score) boxes.
    zones: feeder/drinker polygons with points in 0..1 (None or [] = none).
    stats: if given, receives {"temporal_added": n} as the scan goes."""
    tracker = tracker or BroilerTracker()
    tracker.reset()
    guarded = iter_guarded_samples(
        frames, interval=settings.interval, freeze_frames=settings.freeze_frames,
        freeze_diff=settings.freeze_diff, max_step=settings.max_time_step,
        exclusions=settings.exclusions,
    )
    need_reset = False
    warmup_left = 0
    session = 0
    id_base = 0          # added to the tracker's numbers so they stay unique across sessions
    highest = 0
    body_lengths: deque[float] = deque(maxlen=500)
    rules: BehaviorTracker | None = None      # made at the first frame, once its size is known
    pending: dict[int, ScanSample] = {}       # frames waiting for their behaviour answer
    seq = 0
    stats = stats if stats is not None else {}
    stats.setdefault("temporal_added", 0)

    def release(answers) -> Iterator[ScanSample]:
        for key, fb in answers:
            s = pending.pop(key)
            if fb is not None:
                s.huddles = [([s.birds[i].id for i in members], origin) for members, origin in fb.huddles]
                s.inactive = list(fb.inactive_ids)
                s.feeding = len(fb.feeding)
            yield s
        if rules is not None:
            stats["temporal_added"] = stats.get("temporal_added_before", 0) + rules.added

    def end_session() -> Iterator[ScanSample]:
        """A gap: settle the frames still waiting, then forget every history."""
        if rules is not None:
            yield from release(rules.flush())
            stats["temporal_added_before"] = stats["temporal_added"]
            rules.reset()

    for item in guarded:
        if cancel is not None and cancel.is_set():
            return
        if item.status == GAP:
            yield from end_session()
            need_reset = True
            yield ScanSample(item.time, item.number, GAP, item.reason, session)
            continue

        if need_reset:
            tracker.reset()
            body_lengths.clear()
            warmup_left = settings.warmup_frames
            need_reset = False
            session += 1
            id_base = highest

        if rules is None:
            h, w = item.frame.shape[:2]
            rules = BehaviorTracker(settings.behavior(), Zones.from_normalized(zones or [], w, h), settings.interval)

        dets = detect(item.frame)
        birds = [
            TrackedBird(id_base + b.stable_id, *b.box, b.score, b.recovered)
            for b in tracker.update(dets)
        ]
        for b in birds:
            highest = max(highest, b.id)

        if len(birds) < settings.min_visible:
            yield from end_session()
            need_reset = True
            yield ScanSample(item.time, item.number, GAP, "too_few_tracked_birds", session, len(dets))
            continue

        if birds:
            body_lengths.append(statistics.median(max(b.w, b.h) for b in birds))
        body_len = sorted(body_lengths)[len(body_lengths) // 2] if body_lengths else None

        if warmup_left > 0:
            warmup_left -= 1
            sample = ScanSample(item.time, item.number, RECOVERING, "tracker_warmup", session,
                                len(dets), body_len, birds)
        else:
            sample = ScanSample(item.time, item.number, VALID, "", session, len(dets), body_len, birds)
        pending[seq] = sample
        answers = rules.push(seq, [b.id for b in birds], [(b.cx, b.cy, b.w, b.h) for b in birds],
                             body_len, item.time, judge=sample.status == VALID)
        seq += 1
        yield from release(answers)

    if not (cancel is not None and cancel.is_set()):
        yield from end_session()


# ---------------------------------------------------------------------------
# Background jobs
# ---------------------------------------------------------------------------

class ScanBusy(RuntimeError):
    """Another clip is being scanned; one at a time keeps the detector usable."""


class ScanJob:
    def __init__(self, clip, settings: ScanSettings, zones: list | None = None, zones_source: str = "none") -> None:
        self.id = uuid.uuid4().hex[:12]
        self.clip_id = clip.id
        self.clip_name = clip.name
        self.path = clip.path
        self.duration = float(clip.duration)
        self.settings = settings
        self.zones = zones or []
        self.zones_source = zones_source
        self.stats: dict = {}
        self.bytetrack = ByteTrackConfig.from_env()
        self.hybrid = HybridConfig.from_env()
        self.status = "running"
        self.error: str | None = None
        self.started = time.time()
        self.finished: float | None = None
        self.samples: list[ScanSample] = []
        self.cancel = threading.Event()
        self.thread: threading.Thread | None = None
        self._lock = threading.Lock()

    @property
    def expected_frames(self) -> int:
        return int(self.duration // self.settings.interval) + 1

    def run(self, detect: Detect, frames=None) -> None:
        try:
            source = frames if frames is not None else sample_frames(self.path, self.settings.interval)
            tracker = BroilerTracker(self.bytetrack, self.hybrid)
            for s in scan(source, detect, self.settings, tracker, self.cancel, self.zones, self.stats):
                with self._lock:
                    self.samples.append(s)
            self.status = "cancelled" if self.cancel.is_set() else "done"
        except Exception as exc:  # noqa: BLE001 - reported to the operator, not swallowed
            logger.exception("Clip scan %s failed", self.id)
            self.status = "failed"
            self.error = str(exc)[:300]
        finally:
            self.finished = time.time()
            logger.info("Clip scan %s on %s: %s, %d samples", self.id, self.clip_id, self.status, len(self.samples))

    def snapshot(self) -> list[ScanSample]:
        with self._lock:
            return list(self.samples)

    def summary(self) -> dict:
        samples = self.snapshot()
        counts = {VALID: 0, GAP: 0, RECOVERING: 0}
        reasons: dict[str, int] = {}
        first: dict[int, float] = {}
        last: dict[int, float] = {}
        birds_per_frame: list[int] = []
        recovered = 0
        for s in samples:
            counts[s.status] += 1
            if s.reason:
                reasons[s.reason] = reasons.get(s.reason, 0) + 1
            if s.status == GAP:
                continue
            birds_per_frame.append(len(s.birds))
            recovered += s.recovered
            for b in s.birds:
                first.setdefault(b.id, s.t)
                last[b.id] = s.t
        lifetimes = sorted(last[k] - first[k] for k in first)
        mean_birds = statistics.mean(birds_per_frame) if birds_per_frame else 0.0
        behaviour = self._behaviour(samples)
        done = len([s for s in samples if s.frame_no is not None])
        elapsed = (self.finished or time.time()) - self.started
        eta = None
        if self.status == "running" and done:
            eta = round(elapsed / done * max(0, self.expected_frames - done), 1)
        return {
            "job_id": self.id,
            "clip_id": self.clip_id,
            "clip_name": self.clip_name,
            "status": self.status,
            "error": self.error,
            "progress": {
                "frames_done": done,
                "frames_expected": self.expected_frames,
                "video_seconds_done": round(samples[-1].t, 1) if samples else 0.0,
                "video_seconds_total": round(self.duration, 1),
                "elapsed_s": round(elapsed, 1),
                "eta_s": eta,
            },
            "counts": counts,
            "gap_reasons": reasons,
            "sessions": (samples[-1].session + 1) if samples else 0,
            "tracking": {
                "distinct_ids": len(first),
                "mean_birds_per_frame": round(mean_birds, 2),
                "ids_per_bird": round(len(first) / mean_birds, 2) if mean_birds else None,
                "median_id_lifetime_s": round(statistics.median(lifetimes), 1) if lifetimes else None,
                "longest_id_lifetime_s": round(lifetimes[-1], 1) if lifetimes else None,
                "recovered_boxes": recovered,
            },
            "behaviour": behaviour,
            "settings": {
                **{k: v for k, v in asdict(self.settings).items() if k != "exclusions"},
                "exclusions": [list(x) for x in self.settings.exclusions],
                "zones": {"source": self.zones_source, "count": len(self.zones)},
                "bytetrack": asdict(self.bytetrack),
                "hybrid": asdict(self.hybrid),
                "behaviour_rules": asdict(self.settings.behavior()),
                "klydel_commit": KLYDEL_COMMIT,
            },
        }

    def _behaviour(self, samples: list[ScanSample]) -> dict:
        """What the rules found over the clip. Only judged (VALID) frames count."""
        judged = [s for s in samples if s.judged]
        huddle_frames = [s for s in judged if s.huddles]
        origins: dict[str, int] = {}
        for s in judged:
            for _, origin in s.huddles:
                origins[origin] = origins.get(origin, 0) + 1
        inactive_frames = [s for s in judged if s.inactive]
        spans: dict[int, list[float]] = {}
        for s in inactive_frames:
            for bid in s.inactive:
                span = spans.setdefault(bid, [s.t, s.t])
                span[1] = s.t
        # The longest stretch of judged frames within one session: can a full inactivity window fit at all?
        longest = 0.0
        run_start = prev = None
        for s in samples:
            if s.judged and prev is not None and prev.judged and prev.session == s.session:
                longest = max(longest, s.t - run_start)
            elif s.judged:
                run_start = s.t
            prev = s
        window = self.settings.inactivity_window_s
        return {
            "judged_frames": len(judged),
            "frames_with_huddling": len(huddle_frames),
            "huddling_share": round(len(huddle_frames) / len(judged), 4) if judged else None,
            "huddle_groups": sum(len(s.huddles) for s in judged),
            "huddle_groups_by_origin": origins,
            "max_birds_huddled": max((sum(len(ids) for ids, _ in s.huddles) for s in judged), default=0),
            "temporal_added": self.stats.get("temporal_added", 0),
            "frames_with_inactivity": len(inactive_frames),
            "inactive_birds": [{"bird": bid, "from_s": round(a, 1), "to_s": round(b, 1)}
                               for bid, (a, b) in sorted(spans.items(), key=lambda kv: kv[1][0])],
            "inactivity_window_s": window,
            "longest_judged_stretch_s": round(longest, 1),
            "window_fits": longest >= window,
        }

    def sample_near(self, t: float) -> ScanSample | None:
        """The non-GAP sample closest to video time t."""
        best = None
        for s in self.snapshot():
            if s.status == GAP or s.frame_no is None:
                continue
            if best is None or abs(s.t - t) < abs(best.t - t):
                best = s
        return best

    def samples_csv(self) -> str:
        """One row per sampled frame. The first columns follow klydel's gap-aware
        log (huddle_ids: groups split by ";", birds by "|"). Behaviour columns are
        blank for GAP and RECOVERING rows: unknown, not zero."""
        buf = io.StringIO()
        w = csv.writer(buf)
        w.writerow(["t_s", "status", "reason", "n_birds", "n_huddles", "n_inactive", "body_len_px",
                    "recovered", "inactive_ids", "huddle_ids", "n_feeding", "huddle_origins",
                    "frame_no", "session", "n_detections", "bird_ids"])
        for s in self.snapshot():
            tracked = s.status != GAP
            judged = s.judged
            w.writerow([
                f"{s.t:.3f}", s.status, s.reason,
                len(s.birds) if tracked else "",
                len(s.huddles) if judged else "",
                len(s.inactive) if judged else "",
                f"{s.body_len:.2f}" if s.body_len else "",
                s.recovered if tracked else "",
                "|".join(map(str, s.inactive)) if judged else "",
                ";".join("|".join(map(str, sorted(ids))) for ids, _ in s.huddles) if judged else "",
                s.feeding if judged else "",
                ";".join(origin for _, origin in s.huddles) if judged else "",
                s.frame_no if s.frame_no is not None else "", s.session,
                s.n_detections if tracked else "",
                "|".join(str(b.id) for b in s.birds),
            ])
        return buf.getvalue()

    def mot_text(self) -> str:
        """MOTChallenge rows (frame,id,x,y,w,h,score,-1,-1,-1) for tools/track_clip.py score."""
        lines = []
        for s in self.snapshot():
            if s.status == GAP or s.frame_no is None:
                continue
            for b in s.birds:
                lines.append(f"{s.frame_no},{b.id},{b.cx - b.w / 2:.2f},{b.cy - b.h / 2:.2f},"
                             f"{b.w:.2f},{b.h:.2f},{b.score:.3f},-1,-1,-1")
        return "\n".join(lines) + ("\n" if lines else "")


class ScanRegistry:
    """At most one scan per clip, and one running at a time."""

    def __init__(self) -> None:
        self._jobs: dict[str, ScanJob] = {}
        self._lock = threading.Lock()

    def get(self, clip_id: str) -> ScanJob | None:
        with self._lock:
            return self._jobs.get(clip_id)

    def start(self, clip, detect: Detect, settings: ScanSettings,
              zones: list | None = None, zones_source: str = "none") -> ScanJob:
        with self._lock:
            running = [j for j in self._jobs.values() if j.status == "running"]
            if running:
                raise ScanBusy(running[0].clip_id)
            job = ScanJob(clip, settings, zones, zones_source)
            self._jobs[clip.id] = job
        job.thread = threading.Thread(target=job.run, args=(detect,), name=f"scan-{job.id}", daemon=True)
        job.thread.start()
        return job

    def cancel(self, clip_id: str) -> ScanJob | None:
        job = self.get(clip_id)
        if job is not None:
            job.cancel.set()
        return job

    def forget(self, clip_id: str) -> None:
        with self._lock:
            job = self._jobs.pop(clip_id, None)
        if job is not None:
            job.cancel.set()


# ---------------------------------------------------------------------------
# Drawing
# ---------------------------------------------------------------------------

_GREEN = (110, 200, 90)
_AMBER = (60, 170, 240)
_RED = (60, 60, 230)
_VIOLET = (220, 110, 170)
_STATUS_COLOUR = {VALID: (110, 200, 90), RECOVERING: (60, 170, 240), GAP: (70, 70, 220)}


def annotate(frame: np.ndarray, sample: ScanSample) -> np.ndarray:
    """Boxes with their bird numbers (recovered boxes amber, inactive birds violet),
    a red frame around each huddle group, and a banner saying which sample this is,
    whether it was trusted, and what the rules found."""
    out = frame.copy()
    scale = max(0.45, min(1.2, frame.shape[1] / 1600))
    thick = max(1, int(round(2 * scale)))
    inactive = set(sample.inactive or [])
    by_id = {b.id: b for b in sample.birds}
    for ids, origin in sample.huddles or []:
        members = [by_id[i] for i in ids if i in by_id]
        if not members:
            continue
        x0 = int(min(b.cx - b.w / 2 for b in members)) - 6
        y0 = int(min(b.cy - b.h / 2 for b in members)) - 6
        x1 = int(max(b.cx + b.w / 2 for b in members)) + 6
        y1 = int(max(b.cy + b.h / 2 for b in members)) + 6
        cv2.rectangle(out, (x0, y0), (x1, y1), _RED, thick + 1)
        label = "huddle" if origin == "primary" else "huddle (t)"
        cv2.putText(out, label, (x0, y1 + int(16 * scale)), cv2.FONT_HERSHEY_SIMPLEX, 0.55 * scale, _RED,
                    thick, cv2.LINE_AA)
    for b in sample.birds:
        colour = _VIOLET if b.id in inactive else (_AMBER if b.recovered else _GREEN)
        x0, y0 = int(round(b.cx - b.w / 2)), int(round(b.cy - b.h / 2))
        x1, y1 = int(round(b.cx + b.w / 2)), int(round(b.cy + b.h / 2))
        cv2.rectangle(out, (x0, y0), (x1, y1), colour, thick)
        label = str(b.id)
        (tw, th), _ = cv2.getTextSize(label, cv2.FONT_HERSHEY_SIMPLEX, 0.6 * scale, thick)
        cv2.rectangle(out, (x0, max(0, y0 - th - 6)), (x0 + tw + 6, y0), colour, -1)
        cv2.putText(out, label, (x0 + 3, max(th, y0 - 4)), cv2.FONT_HERSHEY_SIMPLEX,
                    0.6 * scale, (20, 20, 20), thick, cv2.LINE_AA)
    banner = f"t={sample.t:.1f}s  {sample.status}  birds={len(sample.birds)}"
    if sample.judged:
        banner += f"  huddles={len(sample.huddles)}  inactive={len(sample.inactive)}"
    if sample.reason:
        banner += f"  ({sample.reason})"
    cv2.putText(out, banner, (10, int(30 * scale) + 6), cv2.FONT_HERSHEY_SIMPLEX, 0.8 * scale,
                (0, 0, 0), thick + 3, cv2.LINE_AA)
    cv2.putText(out, banner, (10, int(30 * scale) + 6), cv2.FONT_HERSHEY_SIMPLEX, 0.8 * scale,
                _STATUS_COLOUR.get(sample.status, _GREEN), thick, cv2.LINE_AA)
    return out


def detector_fn(detector, settings: ScanSettings) -> Detect:
    """Wrap the service's Detector as a tracking detector (0.1 floor, NMS 0.7)."""
    def detect(frame: np.ndarray):
        return [
            (d.box_x + d.box_w / 2, d.box_y + d.box_h / 2, d.box_w, d.box_h, d.confidence)
            for d in detector.detect(frame, conf_min=settings.conf, nms_iou=settings.nms_iou)
        ]
    return detect


# Used by app.py. Settings are validated when a scan starts (with_overrides),
# so a bad TRACK_* value fails that request instead of stopping the service.
registry = ScanRegistry()
DEFAULT_SETTINGS = ScanSettings.from_env()
