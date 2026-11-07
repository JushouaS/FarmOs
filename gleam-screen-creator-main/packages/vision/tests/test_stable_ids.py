"""
Stable-ID layer tests.

The first two classes are klydel's own unit tests (behavior-pipeline/
test_tracker_hybrid.py and test_hybrid_v2.py at commit 9c6f755), kept with the
same inputs and expected values, so the port is pinned to their behaviour. The
rest test BroilerTracker, the whole chain the clip scan will use.

    cd packages/vision && python -m pytest tests/test_stable_ids.py -q
"""
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import bytetrack as bt  # noqa: E402
import stable_ids as si  # noqa: E402


# ---------------------------------------------------------------------------
# klydel: test_tracker_hybrid.py (HybridIDManager)
# ---------------------------------------------------------------------------

class TestKlydelHybrid:
    def test_new_and_byte_id_switch_still_preserves_nearest_stable_ids(self):
        tr = si.HybridIDManager()
        ids, _, _ = tr.update([101, 102], [[20, 40, 20, 20], [120, 40, 20, 20]], [0.9, 0.9])
        assert ids == [1, 2]
        ids, _, _ = tr.update([102, 101], [[22, 40, 20, 20], [118, 40, 20, 20]], [0.9, 0.9])
        assert ids == [1, 2]

    def test_byte_id_matches_moving_bird_and_persists_gap(self):
        tr = si.HybridIDManager(tight_frac=0.5, wide_frac=4, max_missed=2)
        assert tr.update([7], [[20, 40, 20, 20]], [0.9])[0] == [1]
        assert tr.update([7], [[48, 40, 20, 20]], [0.9])[0] == [1]
        assert tr.update([], [], [])[0] == []
        assert tr.update([99], [[51, 42, 20, 20]], [0.6])[0] == [1]

    def test_not_same_id_if_far_teleport(self):
        tr = si.HybridIDManager()
        assert tr.update([7], [[20, 40, 20, 20]], [0.9])[0] == [1]
        assert tr.update([7], [[500, 500, 20, 20]], [0.9])[0] == [2]

    def test_stale_expiry(self):
        tr = si.HybridIDManager(max_missed=1)
        tr.update([11], [[20, 40, 20, 20]], [0.9])
        tr.update([], [], [])
        tr.update([], [], [])
        assert tr.update([99], [[20, 40, 20, 20]], [0.9])[0] == [2]

    def test_preserves_count_boxes_scores(self):
        tr = si.HybridIDManager()
        boxes = [[20, 30, 15, 20], [50, 60, 18, 22]]
        ids, bb, scores = tr.update([7, 8], boxes, [0.2, 0.7])
        assert len(ids) == 2 and len(set(ids)) == 2
        assert bb == boxes
        assert scores == [0.2, 0.7]

    def test_size_gating(self):
        tr = si.HybridIDManager(max_size_ratio=2)
        assert tr.update([1], [[20, 30, 15, 20]], [0.9])[0] == [1]
        assert tr.update([1], [[20, 30, 150, 200]], [0.9])[0] == [2]

    def test_duplicate_byte_ids_are_refused(self):
        with pytest.raises(ValueError):
            si.HybridIDManager().update([1, 1], [[1, 1, 2, 2], [5, 5, 2, 2]], [0.9, 0.9])


# ---------------------------------------------------------------------------
# klydel: test_hybrid_v2.py (RecoveryHybrid)
# ---------------------------------------------------------------------------

class TestKlydelRecovery:
    def test_recovers_high_confidence_dormant_track(self):
        tr = si.RecoveryHybrid()
        a = tr.update([7], [[10, 10, 20, 20]], [0.9], [[10, 10, 20, 20]], [0.9])
        assert a[0] == [1]
        b = tr.update([], [], [], [[12, 11, 20, 20]], [0.95])
        assert b[0] == [1]
        assert b[3] == 1

    def test_keeps_byte_box_and_does_not_duplicate_it(self):
        tr = si.RecoveryHybrid()
        ids, boxes, _, extra = tr.update([7], [[10, 10, 20, 20]], [0.8],
                                         [[10, 10, 20, 20], [10.2, 9.9, 20, 20]], [0.9, 0.95])
        assert (ids, len(boxes), extra) == ([1], 1, 0)
        assert boxes == [[10.0, 10.0, 20.0, 20.0]]

    def test_does_not_recover_unconfident_raw_box(self):
        tr = si.RecoveryHybrid()
        tr.update([7], [[10, 10, 20, 20]], [.9], [[10, 10, 20, 20]], [.9])
        assert tr.update([], [], [], [[11, 10, 20, 20]], [.4])[3] == 0

    def test_does_not_recover_teleported_box(self):
        tr = si.RecoveryHybrid()
        tr.update([7], [[10, 10, 20, 20]], [.9], [[10, 10, 20, 20]], [.9])
        assert tr.update([], [], [], [[500, 10, 20, 20]], [.99])[3] == 0

    def test_new_raw_only_box_does_not_create_track(self):
        tr = si.RecoveryHybrid()
        assert tr.update([], [], [], [[10, 10, 20, 20]], [.99])[0] == []

    def test_one_to_one_recovery(self):
        tr = si.RecoveryHybrid()
        tr.update([7, 8], [[10, 10, 20, 20], [70, 10, 20, 20]], [.9, .9],
                  [[10, 10, 20, 20], [70, 10, 20, 20]], [.9, .9])
        ids, _, _, extra = tr.update([], [], [], [[12, 10, 20, 20], [72, 10, 20, 20]], [.9, .9])
        assert len(ids) == 2 and len(set(ids)) == 2
        assert extra == 2


# ---------------------------------------------------------------------------
# BroilerTracker: ByteTrack -> stable IDs -> recovery
# ---------------------------------------------------------------------------

def _det(x, y, s=0.9, w=60.0, h=60.0):
    return (x, y, w, h, s)


def test_still_bird_keeps_one_number_when_bytetrack_restarts_it():
    """A bird missed for longer than ByteTrack's buffer is a new ByteTrack ID,
    but the stable layer still calls it by its old number if it reappears in
    place within max_missed frames."""
    t = si.BroilerTracker(bytetrack=bt.ByteTrackConfig(track_buffer=1),
                          hybrid=si.HybridConfig(max_missed=4))
    first = t.update([_det(200, 200)])
    assert [b.stable_id for b in first] == [1]
    for _ in range(3):
        t.update([])
    back = t.update([_det(201, 200)])
    # ByteTrack restarted it as unconfirmed (no output); recovery hands back stable ID 1.
    assert [(b.stable_id, b.recovered, b.byte_id) for b in back] == [(1, True, None)]
    again = t.update([_det(201, 201)])
    assert [(b.stable_id, b.recovered) for b in again] == [(1, False)]
    assert again[0].byte_id == 2


def test_one_frame_clutter_gets_no_number():
    t = si.BroilerTracker()
    t.update([_det(100, 100)])
    out = t.update([_det(100, 100), _det(700, 500, s=0.65)])
    assert [b.stable_id for b in out] == [1]


def test_score_dip_keeps_number_and_box_count():
    t = si.BroilerTracker()
    t.update([_det(100, 100), _det(400, 100)])
    t.update([_det(101, 100), _det(401, 100)])
    out = t.update([_det(102, 100, s=0.25), _det(402, 100)])
    assert sorted(b.stable_id for b in out) == [1, 2]


def test_reset_starts_numbers_again():
    t = si.BroilerTracker()
    t.update([_det(100, 100), _det(300, 300)])
    t.reset()
    assert [b.stable_id for b in t.update([_det(500, 500)])] == [1]


def test_body_length_follows_the_birds():
    t = si.BroilerTracker()
    assert t.body_length() is None
    t.update([_det(100, 100, w=50, h=70), _det(300, 300, w=60, h=40)])
    assert t.body_length() == pytest.approx(65.0, abs=0.5)


def test_hybrid_config_from_env(monkeypatch):
    monkeypatch.setenv("HYBRID_MAX_MISSED", "6")
    assert si.HybridConfig.from_env().max_missed == 6
