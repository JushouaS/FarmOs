"""
MOT metric tests: hand-made cases with known answers, and agreement with the
motmetrics package (what klydel's eval_tracking.py uses) on random data.

    pip install pytest motmetrics     # dev only
    cd packages/vision && python -m pytest tests/test_mot_metrics.py -q
"""
import random
import sys
from pathlib import Path

import numpy as np
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import mot_metrics as mm  # noqa: E402


def _seq(frames, boxes_by_id):
    return {f: dict(boxes_by_id) for f in range(1, frames + 1)}


def test_perfect_tracking():
    gt = _seq(10, {1: (0, 0, 10, 10), 2: (50, 50, 10, 10)})
    s = mm.evaluate(gt, gt)
    assert (s.mota, s.idf1, s.motp, s.num_switches) == (1.0, 1.0, 1.0, 0)


def test_one_id_switch_halfway():
    gt = _seq(10, {1: (0, 0, 10, 10)})
    pred = {f: {7 if f <= 5 else 8: (0, 0, 10, 10)} for f in range(1, 11)}
    s = mm.evaluate(gt, pred)
    assert s.num_switches == 1
    assert s.mota == pytest.approx(0.9)
    assert s.idf1 == pytest.approx(0.5)      # only 5 of the 10 frames carry the kept ID


def test_misses_and_false_positives():
    gt = _seq(4, {1: (0, 0, 10, 10)})
    pred = {1: {1: (0, 0, 10, 10)}, 2: {}, 3: {1: (0, 0, 10, 10), 9: (100, 100, 10, 10)}, 4: {1: (0, 0, 10, 10)}}
    s = mm.evaluate(gt, pred)
    assert (s.num_misses, s.num_false_positives, s.num_switches) == (1, 1, 0)
    assert s.mota == pytest.approx(0.5)


def test_iou_threshold():
    gt = _seq(3, {1: (0, 0, 10, 10)})
    pred = _seq(3, {1: (6, 0, 10, 10)})      # IoU 4/16 = 0.25
    assert mm.evaluate(gt, pred, iou_thr=0.5).num_matches == 0
    assert mm.evaluate(gt, pred, iou_thr=0.2).num_matches == 3


def test_read_write_round_trip(tmp_path):
    path = tmp_path / "pred.txt"
    mm.write_mot(str(path), [(1, 3, 10.0, 20.0, 30.0, 40.0, 0.9), (2, 3, 11.0, 20.0, 30.0, 40.0, 0.8)])
    assert mm.read_mot(str(path)) == {1: {3: (10.0, 20.0, 30.0, 40.0)}, 2: {3: (11.0, 20.0, 30.0, 40.0)}}


def _random_case(seed):
    rng = random.Random(seed)
    gt, pred = {}, {}
    birds = {k: [rng.uniform(0, 500), rng.uniform(0, 500)] for k in range(1, 9)}
    pid = {k: 100 + k for k in birds}
    next_pid = 200
    for f in range(1, 41):
        gt[f], pred[f] = {}, {}
        for k, pos in birds.items():
            pos[0] += rng.gauss(0, 8)
            pos[1] += rng.gauss(0, 8)
            if rng.random() < 0.9:
                gt[f][k] = (pos[0], pos[1], 40.0, 40.0)
            if rng.random() < 0.85:
                if rng.random() < 0.05:            # the tracker renames it
                    pid[k] = next_pid
                    next_pid += 1
                pred[f][pid[k]] = (pos[0] + rng.gauss(0, 6), pos[1] + rng.gauss(0, 6), 40.0, 40.0)
        if rng.random() < 0.3:
            pred[f][next_pid] = (rng.uniform(0, 500), rng.uniform(0, 500), 40.0, 40.0)
            next_pid += 1
    return gt, pred


@pytest.mark.parametrize("seed", range(15))
def test_agrees_with_motmetrics(seed):
    motm = pytest.importorskip("motmetrics")
    if not hasattr(np, "asfarray"):
        np.asfarray = lambda a, dtype=float: np.asarray(a, dtype=dtype)
    gt, pred = _random_case(seed)
    acc = motm.MOTAccumulator(auto_id=True)
    for f in sorted(set(gt) | set(pred)):
        g, p = gt.get(f, {}), pred.get(f, {})
        gids, pids = list(g), list(p)
        dist = motm.distances.iou_matrix([g[i] for i in gids], [p[i] for i in pids], max_iou=0.5)
        acc.update(gids, pids, dist)
    ref = motm.metrics.create().compute(
        acc, metrics=["mota", "motp", "idf1", "num_switches", "num_misses", "num_false_positives"], name="x")
    ours = mm.evaluate(gt, pred, iou_thr=0.5)
    assert ours.num_switches == int(ref["num_switches"].iloc[0])
    assert ours.num_misses == int(ref["num_misses"].iloc[0])
    assert ours.num_false_positives == int(ref["num_false_positives"].iloc[0])
    assert ours.mota == pytest.approx(float(ref["mota"].iloc[0]), abs=1e-9)
    assert ours.motp == pytest.approx(1 - float(ref["motp"].iloc[0]), abs=1e-6)
    assert ours.idf1 == pytest.approx(float(ref["idf1"].iloc[0]), abs=1e-9)
