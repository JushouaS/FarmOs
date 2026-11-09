"""Tests for live_rules.py: the live monitor on the ported ByteTrack and klydel rules."""
from __future__ import annotations

from pathlib import Path

import numpy as np
import pytest

import behavior_log
import live_rules

VISION = Path(__file__).resolve().parent.parent / "gleam-screen-creator-main" / "packages" / "vision"
RNG = np.random.default_rng(7)

# A tight trio (a huddle by klydel's contact rule) and five birds well apart.
TRIO = [(100, 100), (130, 100), (115, 126)]
APART = [(400, 100), (560, 100), (400, 300), (560, 300), (480, 420)]
SIZE = 40


def boxes(centres, score=0.9):
    return [[cx - SIZE / 2, cy - SIZE / 2, SIZE, SIZE, score, 0] for cx, cy in centres]


def picture():
    """A new noisy picture each time, so the freeze check never fires by accident."""
    return RNG.integers(0, 255, (480, 640, 3), dtype=np.uint8)


def run(engine, centres_at, seconds, step=1.0, start=1000.0):
    t = start
    while t < start + seconds:
        assert engine.check(t, picture()) is None
        engine.update(t, boxes(centres_at(t)), 640, 480)
        t += step
    return t


@pytest.mark.skipif(not VISION.is_dir(), reason="packages/vision is not on this computer (the Pi)")
@pytest.mark.parametrize("name", ["bytetrack.py", "stable_ids.py", "behavior_rules.py"])
def test_copies_match_the_laptop_scan(name):
    ours = (Path(__file__).parent / "klydel" / name).read_text(encoding="utf-8")
    theirs = (VISION / name).read_text(encoding="utf-8").replace("from bytetrack import", "from .bytetrack import")
    assert ours.replace("\r\n", "\n") == theirs.replace("\r\n", "\n"), f"re-copy {name} from packages/vision"


def test_still_birds_become_inactive_after_the_window():
    engine = live_rules.LiveRules(inactive_seconds=30, huddle_seconds=600, interval=1.0)
    run(engine, lambda t: APART, 40)
    last = engine.last
    assert last["n"] == 5
    assert all(s is True for s in last["still"])
    status = engine.status(night=False)
    # The whole flock is still: that is flock inactivity, not single inactive birds.
    assert status["flock_inactive"] is not None and status["inactive"] == []
    assert status["rules"].startswith("klydel ")
    row = behavior_log.row(last, True, None, 30, 600)
    assert row["still_birds"] == 5 and row["birds_judged"] == 5


def test_one_still_bird_among_moving_ones_is_inactive():
    engine = live_rules.LiveRules(inactive_seconds=30, huddle_seconds=600, interval=1.0)

    def centres(t):
        wobble = 60 * np.sin(t / 3)
        return [APART[0]] + [(x + wobble, y) for x, y in APART[1:]]

    run(engine, centres, 45)
    status = engine.status(night=False)
    assert len(status["inactive"]) == 1
    assert status["inactive"][0]["still_seconds"] >= 30
    assert engine.status(night=True)["inactive"] == []   # at night a still bird is resting


def test_too_early_to_judge():
    engine = live_rules.LiveRules(inactive_seconds=60, huddle_seconds=600, interval=1.0)
    run(engine, lambda t: APART, 20)
    assert all(s is None for s in engine.last["still"])
    assert "too early" in behavior_log.row(engine.last, True, None, 60, 600)["summary"]


def test_a_huddle_counts_once_it_has_lasted():
    engine = live_rules.LiveRules(inactive_seconds=600, huddle_seconds=10, interval=1.0)
    run(engine, lambda t: TRIO + APART, 8)
    assert engine.status(False)["huddle"] is None          # seen, not yet long enough
    assert engine.last["huddle_groups_now"] == 1
    run(engine, lambda t: TRIO + APART, 10, start=1008.0)
    huddle = engine.status(False)["huddle"]
    assert huddle is not None and huddle["birds"] == 3 and huddle["seconds"] >= 10
    assert huddle["fdi"] == pytest.approx(3 / 8, abs=1e-3)
    assert huddle["warning"] is True                        # 37.5 % >= 35 %


def test_a_huddle_inside_a_feeder_zone_is_feeding():
    zone = [[[0.05, 0.1], [0.35, 0.1], [0.35, 0.4], [0.05, 0.4]]]   # covers the trio
    engine = live_rules.LiveRules(inactive_seconds=600, huddle_seconds=5, interval=1.0, zones=zone)
    run(engine, lambda t: TRIO + APART, 15)
    assert engine.status(False)["huddle"] is None
    assert engine.last["feeding"] == 3


def test_zones_can_change_without_starting_over():
    engine = live_rules.LiveRules(inactive_seconds=600, huddle_seconds=5, interval=1.0)
    # 3 settling pictures, then each answer comes 2 pictures late: the huddle has lasted 5 s by about t = 1010.
    run(engine, lambda t: TRIO + APART, 14)
    assert engine.status(False)["huddle"] is not None
    engine.set_zones([[[0.05, 0.1], [0.35, 0.1], [0.35, 0.4], [0.05, 0.4]]])
    run(engine, lambda t: TRIO + APART, 6, start=1014.0)
    assert engine.status(False)["huddle"] is None
    assert engine.restarts == 0


def test_a_frozen_picture_is_not_judged_and_starts_over():
    engine = live_rules.LiveRules(inactive_seconds=30, huddle_seconds=600, interval=1.0)
    t = run(engine, lambda t: APART, 10)
    frozen = picture()
    answers = [engine.check(t + k, frozen) for k in range(5)]
    assert answers[:2] == [None, None] and answers[2:] == ["frozen_picture"] * 3
    assert engine.restarts == 1 and engine.status(False)["gap"]["reason"] == "frozen_picture"
    assert engine.last is None


def test_a_jump_in_time_starts_the_birds_over():
    engine = live_rules.LiveRules(inactive_seconds=30, huddle_seconds=600, interval=1.0)
    run(engine, lambda t: APART, 10)
    first_ids = set(engine.last["ids"])
    run(engine, lambda t: APART, 10, start=1100.0)          # 90 s with no picture
    assert engine.restarts == 1 and engine.status(False)["gap"]["reason"] == "time_jump"
    assert not first_ids & set(engine.last["ids"])          # new numbers after the gap


def test_slow_pictures_still_get_judged():
    # Pictures every 6 s although 3 s was asked for: "seen in half the pictures" follows the real pace.
    engine = live_rules.LiveRules(inactive_seconds=120, huddle_seconds=600, interval=3.0)
    engine.max_gap = 60
    run(engine, lambda t: APART, 150, step=6.0)
    assert all(s is True for s in engine.last["still"])
    assert engine.measured_interval() == pytest.approx(6.0)


def test_the_monitor_keeps_the_zones_on_disk(tmp_path, monkeypatch):
    import live_behavior

    monkeypatch.setattr(live_behavior, "ZONES_FILE", tmp_path / "behavior_zones.json")
    monitor = live_behavior.LiveBehavior(lambda: None)
    assert monitor.status(False)["zones_version"] is None
    zone = [[[0.1, 0.1], [0.3, 0.1], [0.3, 0.3]]]
    monitor.set_zones(zone, "abc123")
    assert monitor.status(False)["zones_version"] == "abc123"
    assert monitor.status(False)["zones"] == 1
    again = live_behavior.LiveBehavior(lambda: None)     # after a restart, without the API
    assert again.status(False)["zones_version"] == "abc123" and again.status(False)["zones"] == 1


def test_valid_zones():
    good = [[[0, 0], [1, 0], [0.5, 1]]]
    assert live_rules.valid_zones(good) == [[[0.0, 0.0], [1.0, 0.0], [0.5, 1.0]]]
    assert live_rules.valid_zones([]) == []
    for bad in (None, "x", [[[0, 0], [1, 0]]], [[[0, 0], [1, 0], [2, 1]]], [[[0, 0], [1, 0], [True, 1]]]):
        assert live_rules.valid_zones(bad) is None
