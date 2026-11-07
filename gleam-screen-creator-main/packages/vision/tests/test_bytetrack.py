"""
ByteTrack tests.

Two kinds:
  - Parity with the reference: the same detections go into our BYTETracker and
    Ultralytics' BYTETracker (what klydel's model.track() runs), and the IDs
    and boxes must agree in every frame. These skip when ultralytics is not
    installed (it is a dev tool, not in the service image).
  - Behaviour: small hand-made scenes that pin down what each ByteTrack step
    is for, so a later "simplification" that breaks one of them fails here.

    pip install pytest ultralytics      # dev only
    cd packages/vision && python -m pytest tests/test_bytetrack.py -q
"""
import random
import sys
from pathlib import Path
from types import SimpleNamespace

import numpy as np
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import bytetrack as bt  # noqa: E402


# ---------------------------------------------------------------------------
# Synthetic flock: birds wander, scores dip, detections go missing, false boxes appear
# ---------------------------------------------------------------------------

def flock_scene(seed: int, frames: int = 60, birds: int = 18, size: float = 60.0,
                width: float = 1280, height: float = 720):
    """Detections per frame as (cx, cy, w, h, score), plus the true bird of each (or None)."""
    rng = random.Random(seed)
    state = []
    for _ in range(birds):
        state.append({
            "x": rng.uniform(size, width - size), "y": rng.uniform(size, height - size),
            "vx": 0.0, "vy": 0.0,
            "w": size * rng.uniform(0.8, 1.3), "h": size * rng.uniform(0.8, 1.3),
            "still": rng.random() < 0.4,
        })
    scenes, truth = [], []
    for _ in range(frames):
        dets, who = [], []
        for k, b in enumerate(state):
            if not b["still"]:
                b["vx"] = 0.7 * b["vx"] + rng.gauss(0, 6)
                b["vy"] = 0.7 * b["vy"] + rng.gauss(0, 6)
            b["x"] = min(width - size, max(size, b["x"] + b["vx"] + rng.gauss(0, 1.5)))
            b["y"] = min(height - size, max(size, b["y"] + b["vy"] + rng.gauss(0, 1.5)))
            if rng.random() < 0.08:          # the detector misses it
                continue
            score = rng.uniform(0.65, 0.95)
            if rng.random() < 0.15:          # half hidden: a low score
                score = rng.uniform(0.12, 0.58)
            dets.append((b["x"] + rng.gauss(0, 2), b["y"] + rng.gauss(0, 2),
                         b["w"] * rng.uniform(0.92, 1.08), b["h"] * rng.uniform(0.92, 1.08), score))
            who.append(k)
        for _ in range(rng.choice([0, 0, 1, 2])):   # clutter
            dets.append((rng.uniform(0, width), rng.uniform(0, height), size, size, rng.uniform(0.11, 0.8)))
            who.append(None)
        order = list(range(len(dets)))
        rng.shuffle(order)
        scenes.append([dets[i] for i in order])
        truth.append([who[i] for i in order])
    return scenes, truth


# ---------------------------------------------------------------------------
# Parity with Ultralytics
# ---------------------------------------------------------------------------

class _Results:
    """The minimum of an Ultralytics Boxes object that BYTETracker.update reads."""

    def __init__(self, xywh, conf):
        self.xywh = np.asarray(xywh, dtype=np.float32).reshape(-1, 4)
        self.conf = np.asarray(conf, dtype=np.float32).reshape(-1)
        self.cls = np.zeros(len(self.conf), dtype=np.float32)

    def __len__(self):
        return len(self.conf)

    def __getitem__(self, mask):
        return _Results(self.xywh[mask], self.conf[mask])


def _reference(config: bt.ByteTrackConfig):
    pytest.importorskip("lap")
    module = pytest.importorskip("ultralytics.trackers.byte_tracker")
    args = SimpleNamespace(
        track_high_thresh=config.track_high_thresh, track_low_thresh=config.track_low_thresh,
        new_track_thresh=config.new_track_thresh, track_buffer=config.track_buffer,
        match_thresh=config.match_thresh, fuse_score=config.fuse_score,
    )
    return module.BYTETracker(args)


def _run_both(scenes, config):
    ours, ref = bt.BYTETracker(config), _reference(config)
    for n, dets in enumerate(scenes, start=1):
        out = ours.update(dets)
        arr = np.asarray([d[:4] for d in dets], dtype=np.float32).reshape(-1, 4)
        res = ref.update(_Results(arr, [d[4] for d in dets]))
        yield n, out, res


CONFIGS = [
    bt.ByteTrackConfig(),                                               # paper / klydel thresholds
    bt.ByteTrackConfig(match_thresh=0.95),                              # klydel's match_thresh
    bt.ByteTrackConfig(fuse_score=True),                                # MOT17-style score fusion
    bt.ByteTrackConfig(track_high_thresh=0.25, new_track_thresh=0.25),  # Ultralytics defaults
    bt.ByteTrackConfig(track_buffer=3),                                 # short buffer: exercises removal
]


@pytest.mark.parametrize("config", CONFIGS, ids=["paper", "klydel-match", "fuse", "ultra-default", "buffer3"])
@pytest.mark.parametrize("seed", range(12))
def test_same_ids_and_boxes_as_ultralytics(config, seed):
    scenes, _ = flock_scene(seed)
    for n, out, res in _run_both(scenes, config):
        ours = sorted((o.track_id, o.det_index) for o in out)
        theirs = sorted((int(r[4]), int(r[7])) for r in res)
        assert ours == theirs, f"frame {n}: ours {ours} vs ultralytics {theirs}"
        boxes = {o.track_id: o.box for o in out}
        for r in res:
            x1, y1, x2, y2 = (float(v) for v in r[:4])
            cx, cy, w, h = boxes[int(r[4])]
            assert (cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2) == pytest.approx((x1, y1, x2, y2), abs=0.05)


@pytest.mark.parametrize("seed", range(4))
def test_pure_python_solver_gives_the_same_tracks(monkeypatch, seed):
    """The Raspberry Pi may have no scipy; the fallback solver must not change a single ID."""
    monkeypatch.setattr(bt, "_solve_square", bt._hungarian)
    scenes, _ = flock_scene(seed, frames=40)
    for n, out, res in _run_both(scenes, bt.ByteTrackConfig()):
        assert sorted((o.track_id, o.det_index) for o in out) == sorted((int(r[4]), int(r[7])) for r in res), n


def test_kalman_matches_reference_filter():
    kf_mod = pytest.importorskip("ultralytics.trackers.utils.kalman_filter")
    ref = kf_mod.KalmanFilterXYAH()
    rng = random.Random(3)
    z = [300.0, 200.0, 1.1, 60.0]
    ours = bt.KalmanXYAH(z)
    mean, cov = ref.initiate(np.array(z))
    for step in range(40):
        ours.predict()
        mean, cov = ref.predict(mean, cov)
        if step % 5 != 4:   # some frames without a measurement
            z = [z[0] + rng.gauss(4, 3), z[1] + rng.gauss(-2, 3), 1.1 + rng.gauss(0, 0.05), 60 + rng.gauss(0, 2)]
            ours.update(z)
            mean, cov = ref.update(mean, cov, np.array(z))
        assert ours.mean + ours.vel == pytest.approx(list(mean), rel=1e-9, abs=1e-9)
        for i in range(4):
            assert ours.cov[i] == pytest.approx([cov[i, i], cov[i, i + 4], cov[i + 4, i + 4]], rel=1e-9, abs=1e-12)
            # The split into four 2-state filters is exact: nothing couples different coordinates.
            for j in range(8):
                if j not in (i, i + 4):
                    assert cov[i, j] == pytest.approx(0.0, abs=1e-12)


def test_assignment_matches_lapjv_with_cost_limit():
    lap = pytest.importorskip("lap")
    rng = np.random.default_rng(5)
    for _ in range(300):
        n, m = int(rng.integers(1, 9)), int(rng.integers(1, 9))
        cost = rng.random((n, m))
        thresh = float(rng.choice([0.2, 0.5, 0.7, 0.8, 0.95]))
        matches, u_rows, u_cols = bt.linear_assignment(cost.tolist(), thresh)
        _, x, y = lap.lapjv(cost, extend_cost=True, cost_limit=thresh)
        assert sorted(matches) == sorted((i, int(j)) for i, j in enumerate(x) if j >= 0)
        assert sorted(u_rows) == sorted(int(i) for i in np.where(x < 0)[0])
        assert sorted(u_cols) == sorted(int(j) for j in np.where(y < 0)[0])


def test_pure_python_solver_matches_scipy():
    scipy_opt = pytest.importorskip("scipy.optimize")
    rng = np.random.default_rng(9)
    for _ in range(200):
        n = int(rng.integers(1, 12))
        cost = rng.random((n, n))
        cols = bt._hungarian(cost.tolist())
        r, c = scipy_opt.linear_sum_assignment(cost)
        assert sum(cost[i, cols[i]] for i in range(n)) == pytest.approx(float(cost[r, c].sum()))


# ---------------------------------------------------------------------------
# What each step is for
# ---------------------------------------------------------------------------

def _box(x, y, s=0.9, w=60.0, h=60.0):
    return (x, y, w, h, s)


def _ids(out):
    return sorted(o.track_id for o in out)


def test_first_frame_birds_are_confirmed_at_once():
    t = bt.BYTETracker()
    assert _ids(t.update([_box(100, 100), _box(300, 100)])) == [1, 2]


def test_a_later_new_bird_is_only_output_from_its_second_sighting():
    t = bt.BYTETracker()
    t.update([_box(100, 100)])
    out = t.update([_box(100, 100), _box(400, 300)])
    assert _ids(out) == [1]                 # the newcomer is unconfirmed
    out = t.update([_box(100, 100), _box(402, 301)])
    assert _ids(out) == [1, 2]


def test_a_one_frame_false_box_never_gets_an_id():
    t = bt.BYTETracker()
    t.update([_box(100, 100)])
    t.update([_box(100, 100), _box(600, 400, s=0.8)])   # clutter, once
    for _ in range(5):
        out = t.update([_box(100, 100)])
    assert _ids(out) == [1]
    assert t._next_id == 2                  # it was started, then removed unconfirmed


def test_a_weak_box_never_starts_a_bird():
    t = bt.BYTETracker()
    t.update([_box(100, 100)])
    for _ in range(4):
        out = t.update([_box(100, 100), _box(500, 300, s=0.5)])
    assert _ids(out) == [1]


def test_byte_step_keeps_a_bird_whose_score_dips():
    """The point of ByteTrack: a low-score box still continues a known bird."""
    t = bt.BYTETracker()
    t.update([_box(100, 100)])
    t.update([_box(101, 100)])
    out = t.update([_box(102, 100, s=0.3)])    # half hidden
    assert _ids(out) == [1]
    # Without the low band the same box is dropped and the bird is lost for that frame.
    t2 = bt.BYTETracker(bt.ByteTrackConfig(track_low_thresh=0.59))
    t2.update([_box(100, 100)])
    t2.update([_box(101, 100)])
    assert _ids(t2.update([_box(102, 100, s=0.3)])) == []


def test_a_low_box_cannot_revive_a_lost_bird():
    """The second association only uses birds tracked until now, not lost ones."""
    t = bt.BYTETracker()
    t.update([_box(100, 100)])
    t.update([])                              # lost
    assert _ids(t.update([_box(100, 100, s=0.3)])) == []
    assert _ids(t.update([_box(100, 100, s=0.9)])) == [1]   # a confident box re-finds it


def test_lost_bird_keeps_its_id_within_the_buffer_and_not_after():
    cfg = bt.ByteTrackConfig(track_buffer=5)
    t = bt.BYTETracker(cfg)
    t.update([_box(100, 100)])
    for _ in range(5):
        t.update([])
    assert _ids(t.update([_box(100, 100)])) == [1]
    t = bt.BYTETracker(cfg)
    t.update([_box(100, 100)])
    for _ in range(7):                        # removed after buffer + 1 (the reference's ordering)
        t.update([])
    t.update([_box(100, 100)])
    assert _ids(t.update([_box(100, 100)])) == [2]


def test_two_birds_crossing_keep_their_ids():
    t = bt.BYTETracker()
    seen = {}
    for k in range(25):
        a = _box(100 + 20 * k, 200)
        b = _box(580 - 20 * k, 205)
        out = t.update([a, b])
        for o in out:
            seen.setdefault(o.track_id, []).append(o.box[0])
    # Bird 1 moved right the whole way, bird 2 left: no swap at the crossing.
    assert seen[1] == sorted(seen[1])
    assert seen[2] == sorted(seen[2], reverse=True)


def test_zero_size_boxes_are_ignored():
    t = bt.BYTETracker()
    assert _ids(t.update([_box(100, 100, w=0), _box(200, 100)])) == [1]


def test_reset_forgets_everything():
    t = bt.BYTETracker()
    t.update([_box(100, 100)])
    t.reset()
    assert t.frame_id == 0 and not t.tracked and not t.lost
    assert _ids(t.update([_box(100, 100)])) == [1]


def test_match_thresh_is_a_cost_limit():
    """0.95 accepts IoU >= 0.05, not IoU >= 0.5."""
    _, _, cols = bt.linear_assignment([[0.9]], 0.95)       # IoU 0.1
    assert cols == []
    _, rows, _ = bt.linear_assignment([[0.9]], 0.8)
    assert rows == [0]


def test_config_from_env(monkeypatch):
    monkeypatch.setenv("BYTETRACK_BUFFER", "45")
    monkeypatch.setenv("BYTETRACK_FUSE_SCORE", "true")
    cfg = bt.ByteTrackConfig.from_env()
    assert cfg.track_buffer == 45 and cfg.fuse_score is True
    assert cfg.track_high_thresh == 0.6
