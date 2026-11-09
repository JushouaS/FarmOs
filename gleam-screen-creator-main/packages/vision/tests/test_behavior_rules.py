"""
Huddling and inactivity rule tests (behavior_rules.py).

  - klydel's own rule tests (hybridv2 behavior validation/test_behavior_rules.py, commit 9c6f755).
  - A replay of klydel's recorded Day 6 run: their tracked birds go in, and the
    huddle groups they recorded must come out (tests/data/klydel_day6_first300.json.gz,
    300 frames). That run used their earlier grouping (average with chaining), so it
    checks the parts shared with the strict method: zones, overlap and trio recovery.
  - Small hand-made scenes for each step of the strict method.

    cd packages/vision && python -m pytest tests/test_behavior_rules.py -q
"""
import gzip
import json
import sys
from collections import defaultdict, deque
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import behavior_rules as br  # noqa: E402

DATA = Path(__file__).with_name("data") / "klydel_day6_first300.json.gz"


# ---------------------------------------------------------------------------
# klydel's tests
# ---------------------------------------------------------------------------

def test_30_minute_stationary():
    early = {7: deque((float(t), 100.0, 100.0) for t in range(0, 1800, 2))}
    full = {7: deque((float(t), 100.0, 100.0) for t in range(0, 1801, 2))}
    assert 7 not in br.update_inactivity(early, 1798., 1800., 15., 450)
    assert 7 in br.update_inactivity(full, 1800., 1800., 15., 450)


def test_30_minute_moving():
    history = {7: deque((float(t), 100.0 + t / 4, 100.0) for t in range(0, 1801, 2))}
    assert 7 not in br.update_inactivity(history, 1800., 1800., 15., 450)


def test_sparse_history_is_not_inactive():
    history = {7: deque([(0.0, 100.0, 100.0), (900.0, 100.0, 100.0), (1800.0, 100.0, 100.0)])}
    assert 7 not in br.update_inactivity(history, 1800., 1800., 15., 450)


def test_huddling_requires_three():
    groups = br.detect_huddles([(100, 100), (105, 102), (107, 103), (400, 400)], body_len_px=20, min_birds=3)
    assert len(groups) == 1 and len(groups[0]) == 3


def test_only_two_not_huddling():
    assert br.detect_huddles([(100, 100), (108, 100), (400, 400)], 20, 3) == []


# ---------------------------------------------------------------------------
# Replay of klydel's Day 6 run
# ---------------------------------------------------------------------------

@pytest.fixture(scope="module")
def day6():
    return json.loads(gzip.decompress(DATA.read_bytes()))


def test_day6_feeder_zones_match(day6):
    zones = br.Zones.from_klydel(day6["zones"], 1280, 720)
    mismatches = sum(zones.contains(b[0], b[1]) != bool(ex)
                     for f in day6["frames"] for b, ex in zip(f["boxes"], f["feeder"]))
    total = sum(len(f["boxes"]) for f in day6["frames"])
    assert total > 7000 and mismatches <= 1     # one bird on a zone edge, rounded to 2 decimals in the export


def test_day6_huddle_groups_match(day6):
    zones = br.Zones.from_klydel(day6["zones"], 1280, 720)
    for f in day6["frames"]:
        boxes, body = f["boxes"], f["body"]
        keep = [i for i, ex in enumerate(f["feeder"]) if not ex]
        cents = [(b[0], b[1]) for b in boxes]
        found = br.detect_huddles_average_linkage([cents[i] for i in keep], body, 3) if body else []
        cand = [sorted(keep[i] for i in c) for c in found]
        overlap = {tuple(c): br.cluster_zone_overlap_fraction(c, boxes, zones) for c in cand}
        ours = br.filter_clusters(cand, overlap, 0.30, True, keep, boxes, body, zones)
        theirs = defaultdict(list)
        for tid, c in zip(f["ids"], f["cluster"]):
            if c:
                theirs[c].append(tid)
        assert sorted(sorted(f["ids"][i] for i in c) for c in ours) == sorted(sorted(v) for v in theirs.values()), f["t"]


# ---------------------------------------------------------------------------
# The strict method, step by step
# ---------------------------------------------------------------------------

def test_strict_grouping_does_not_chain():
    """A-B and B-C are close, A-C is not: chaining joins all three, the strict rule does not."""
    pts = [(0, 0), (8, 0), (16, 0)]
    assert br.detect_huddles(pts, 10, 3) == [[0, 1, 2]]
    assert br.detect_huddles_average_no_chaining(pts, 10, 3) == []
    assert br.detect_huddles_average_no_chaining([(0, 0), (6, 0), (3, 5)], 10, 3) == [[0, 1, 2]]


def _boxes(points, size=10.0):
    return [(x, y, size, size) for x, y in points]


def test_birds_in_a_zone_cannot_huddle_but_stay_tracked():
    zones = br.Zones(rects=((0, 0, 50, 50),))
    assert br.huddling_indices([(10, 10), (60, 60), (49, 49)], zones) == [1]


def test_mostly_covered_group_is_dropped():
    zones = br.Zones(rects=((0, 0, 100, 18),))
    boxes = _boxes([(10, 10), (16, 10), (13, 15)])
    frac = br.cluster_zone_overlap_fraction([0, 1, 2], boxes, zones)
    assert frac >= 0.30
    kept = br.filter_clusters([[0, 1, 2]], {(0, 1, 2): frac}, 0.30, False, [0, 1, 2], boxes, 10, zones)
    assert kept == []


def test_local_recovery_finds_a_tight_trio():
    boxes = _boxes([(0, 0), (6, 0), (3, 5), (200, 200)])
    assert br.recover_compact_triplets([], [0, 1, 2, 3], boxes, 10, br.Zones(), 0.30) == [[0, 1, 2]]
    # Not tight enough: mean pair distance above 0.75 body.
    loose = _boxes([(0, 0), (9, 0), (4.5, 8.5)])
    assert br.recover_compact_triplets([], [0, 1, 2], loose, 10, br.Zones(), 0.30) == []


def test_polygon_zones_agree_with_rectangles():
    rect = br.Zones(rects=((10, 10, 60, 40),))
    poly = br.Zones(polygons=(((10, 10), (60, 10), (60, 40), (10, 40)),))
    for r in [(0, 0, 50, 50), (20, 20, 30, 30), (55, 35, 90, 90), (100, 100, 120, 120)]:
        assert poly.covered_fraction(r) == pytest.approx(rect.covered_fraction(r), abs=0.03)
    assert poly.contains(30, 20) and not poly.contains(5, 5)


def test_settings_zones_become_rectangles_or_polygons():
    z = br.Zones.from_normalized([[[0.1, 0.1], [0.5, 0.1], [0.5, 0.3], [0.1, 0.3]],
                                  [[0.6, 0.6], [0.9, 0.6], [0.75, 0.9]]], 1000, 500)
    assert z.rects == ((100.0, 50.0, 500.0, 150.0),)
    assert len(z.polygons) == 1 and len(z) == 2


def test_settings_are_checked():
    br.BehaviorSettings().validate()
    with pytest.raises(ValueError):
        br.BehaviorSettings(cluster_zone_overlap=0.15).validate()      # temporal needs 0.30
    with pytest.raises(ValueError):
        br.BehaviorSettings(huddle_method="complete", local_recovery=True, temporal_recovery=False).validate()
    br.BehaviorSettings(huddle_method="complete", local_recovery=False, temporal_recovery=False,
                        cluster_zone_overlap=0.15).validate()


# ---------------------------------------------------------------------------
# BehaviorTracker: frame order, temporal delay, gaps
# ---------------------------------------------------------------------------

ZONES = br.Zones(rects=((900, 900, 1000, 1000),))   # far away; temporal recovery needs zones to exist


def _frame(trio_gap):
    """Bird 1-3 a trio (spread `trio_gap` body lengths apart), bird 4 far off. Body 10 px."""
    pts = [(100, 100), (100 + 10 * trio_gap, 100), (100 + 5 * trio_gap, 100 + 8 * trio_gap), (500, 500)]
    return [1, 2, 3, 4], _boxes(pts)


def test_temporal_answers_arrive_two_frames_late_and_flush_gives_the_rest():
    bt = br.BehaviorTracker(br.BehaviorSettings(window_s=60), ZONES, 2.0)
    out = []
    for k in range(5):
        ids, boxes = _frame(0.6)
        out += bt.push(k, ids, boxes, 10.0, 2.0 * k)
    assert [key for key, _ in out] == [0, 1, 2]
    rest = bt.flush()
    assert [key for key, _ in rest] == [3, 4]
    assert all(fb.huddles and sorted(fb.huddles[0][0]) == [1, 2, 3] for _, fb in out + rest)   # bird numbers


def _record(seq, gap):
    """Birds 1-3 in a triangle `gap` body lengths apart (boxes touching), bird 4 far off; primary found nothing."""
    pts = [(100, 100), (100 + 10 * gap, 100), (100 + 5 * gap, 100 + 8.66 * gap), (500, 500)]
    return {"seq": seq, "t": 2.0 * seq, "ids": [1, 2, 3, 4], "boxes": [(x, y, 10.0, 10.0) for x, y in pts],
            "body_len": 10.0, "keep_indices": [0, 1, 2, 3], "huddles": []}


def test_temporal_recovery_adds_a_trio_only_with_support():
    """A trio the primary pass did not group is added when it is touching now and stays
    close in the 2 frames before and the 2 after."""
    target = _record(2, 0.95)
    supported = [_record(0, 0.9), _record(1, 0.9), target, _record(3, 0.9), _record(4, 0.9)]
    clusters, audit = br.temporal_recover_huddles(target, supported, ZONES)
    assert clusters == [([0, 1, 2], "temporal_strict")]
    assert audit[0][1] == "temporal_strict" and audit[0][-1] == 4
    # One neighbour has them far apart: no longer 4 supporting frames.
    unsupported = [_record(0, 0.9), _record(1, 3.0), target, _record(3, 0.9), _record(4, 0.9)]
    assert br.temporal_recover_huddles(target, unsupported, ZONES)[0] == []
    # Without future frames there is no temporal answer at all.
    assert br.temporal_recover_huddles(target, supported[:3], ZONES)[0] == []
    # A primary group is always kept as it is.
    primary = dict(target, huddles=[[0, 1, 2]])
    assert br.temporal_recover_huddles(primary, supported, ZONES)[0] == [([0, 1, 2], "primary")]


def test_recovering_frames_give_context_but_no_answer():
    bt = br.BehaviorTracker(br.BehaviorSettings(window_s=60), ZONES, 2.0)
    res = []
    for k in range(5):
        ids, boxes = _frame(0.6)
        res += bt.push(k, ids, boxes, 10.0, 2.0 * k, judge=k >= 2)
    res += bt.flush()
    assert [(key, fb is None) for key, fb in res] == [(0, True), (1, True), (2, False), (3, False), (4, False)]


def test_inactivity_over_a_short_window_and_reset():
    bt = br.BehaviorTracker(br.BehaviorSettings(window_s=10, temporal_recovery=False), br.Zones(), 2.0)
    still = None
    for k in range(7):                   # 0..12 s: bird 4 never moves, bird 1 walks
        ids = [1, 4]
        boxes = [(100 + 20 * k, 100, 10, 10), (500, 500, 10, 10)]
        (_, fb), = bt.push(k, ids, boxes, 10.0, 2.0 * k)
        still = fb
    assert still.inactive_ids == [4]
    bt.reset()
    (_, fb), = bt.push(99, [4], [(500, 500, 10, 10)], 10.0, 14.0)
    assert fb.inactive_ids == []         # the window starts again after a gap


def test_feeding_birds_are_reported():
    zones = br.Zones(rects=((0, 0, 50, 50),))
    bt = br.BehaviorTracker(br.BehaviorSettings(temporal_recovery=False), zones, 2.0)
    (_, fb), = bt.push(0, [1, 2], [(10, 10, 10, 10), (300, 300, 10, 10)], 10.0, 0.0)
    assert fb.feeding == [1]                     # bird 1 is inside the zone


# ---------------------------------------------------------------------------
# klydel a365f3d: their best Day 6 run, and each rule it changed
# ---------------------------------------------------------------------------

DATA_A365 = Path(__file__).with_name("data") / "klydel_a365f3d_day6_first300.json.gz"


def _groups(text):
    return sorted(tuple(sorted(int(x) for x in g.split("|"))) for g in text.split(";")) if text else []


def test_a365f3d_day6_run_is_reproduced():
    """Their tracked birds and detections in, their recorded huddle groups out (contact method, overlap 0.30,
    trio and temporal recovery, 15 px feeder margin, huddling-only detections). The full 1,803 frames were
    checked when porting: identical to their module on all, 1,802 equal to their log."""
    data = json.loads(gzip.decompress(DATA_A365.read_bytes()))
    zones = br.Zones.from_klydel(data["zones"], 1280, 720)
    bt = br.BehaviorTracker(br.BehaviorSettings(), zones, 2.0)
    got = {}
    for f in data["frames"]:
        for key, fb in bt.push(f["t"], f["ids"], f["boxes"], f["body"], f["t"], frame_no=f["n"],
                               raw_boxes=f["raw_boxes"], raw_scores=f["raw_scores"]):
            got[key] = sorted(tuple(ids) for ids, _o in fb.huddles)
    for key, fb in bt.flush():
        got[key] = sorted(tuple(ids) for ids, _o in fb.huddles)
    wrong = [f["t"] for f in data["frames"] if got[f["t"]] != _groups(f["huddle_ids"])]
    assert wrong == []
    assert any(g < 0 for f in data["frames"] for grp in _groups(f["huddle_ids"]) for g in grp)   # raw birds took part
    assert bt.added > 0                                                                           # and temporal recovery


def test_birds_inside_a_zone_can_huddle_unless_the_group_is_mostly_covered():
    zone = br.Zones(rects=((0, 0, 100, 100),), frame=(1280, 720))
    trio = [(50, 50, 10, 10), (58, 50, 10, 10), (54, 57, 10, 10)]
    settings = br.BehaviorSettings(temporal_recovery=False, huddle_raw_recovery=False)
    p = br.frame_pass([1, 2, 3], trio, 10.0, zone, settings, defaultdict(deque), 0.0, 2.0)
    assert p["huddles"] == [] and p["feeding"] == [1, 2, 3]            # covered: feeding, not huddling
    small = br.Zones(rects=((0, 0, 55, 54),), frame=(1280, 720))
    p = br.frame_pass([1, 2, 3], trio, 10.0, small, settings, defaultdict(deque), 0.0, 2.0, wide_zones=small)
    assert p["huddles"] == [[0, 1, 2]] and p["feeding"] == [1]          # bird 1 is in the zone, the group still counts
    old = br.BehaviorSettings(temporal_recovery=False, huddle_raw_recovery=False, hard_feeder_exclusion=True)
    assert br.frame_pass([1, 2, 3], trio, 10.0, small, old, defaultdict(deque), 0.0, 2.0, wide_zones=small)["huddles"] == []


def test_zones_are_widened_in_reference_pixels_and_kept_in_the_picture():
    z = br.Zones.from_klydel({"ref_size": [640, 360], "zones": [[0, 100, 200, 150]]}, 1280, 720)
    assert z.widened(15).rects == ((0.0, 170.0, 430.0, 330.0),)        # 15 ref px = 30 frame px; x clamped at 0
    poly = br.Zones.from_normalized([[[0.4, 0.4], [0.6, 0.4], [0.5, 0.6]]], 1280, 720).widened(15)
    assert poly.contains(512, 300) and not poly.contains(400, 300)     # 13 px left of the outline: inside the margin


def test_contact_grouping_prefers_birds_whose_bodies_touch():
    # By centres alone birds 0, 1 and 2 group; bird 3's body touches bird 1's, so the contact method takes 1, 2, 3.
    boxes = [(13, 4, 2, 2), (7, 2, 8, 8), (7, 8, 2, 2), (0, 4, 8, 8)]
    assert br.detect_huddles_average_no_chaining([b[:2] for b in boxes], 10, 3) == [[0, 1, 2]]
    assert br.detect_huddles_contact_aware(boxes, 10, 3) == [[1, 2, 3]]
    # The hard rule still holds: a pair one body length apart or more never shares a group.
    assert br.detect_huddles_contact_aware([(0, 0, 4, 4), (20, 0, 4, 4), (10, 15, 4, 4)], 10, 3) == []


def test_contact_trio_recovery_needs_touching_bodies():
    touching = [(0, 0, 9, 9), (8.6, 0, 9, 9), (4.3, 7.5, 9, 9)]
    assert br.recover_contact_triplets([], [0, 1, 2], touching, 10, br.Zones(), 0.30) == [[0, 1, 2]]
    apart = [(0, 0, 4, 4), (8.6, 0, 4, 4), (4.3, 7.5, 4, 4)]          # same centres, small boxes: not touching
    assert br.recover_contact_triplets([], [0, 1, 2], apart, 10, br.Zones(), 0.30) == []


def test_huddling_only_detections_never_reach_inactivity():
    ids, boxes = [1, 2], [(100, 100, 10, 10), (108, 100, 10, 10)]
    raw = [(100, 100, 10, 10), (104, 107, 10, 10), (400, 400, 10, 10), (104, 108, 10, 10)]
    scores = [0.9, 0.5, 0.9, 0.2]
    out_ids, out_boxes, added = br.augment_with_untracked(ids, boxes, raw, scores, 10.0, frame_no=7)
    assert added == {-7002: 0.5}           # duplicate of bird 1, too far, and too weak are all left out
    history = defaultdict(deque)
    settings = br.BehaviorSettings(temporal_recovery=False)
    p = br.frame_pass(ids, boxes, 10.0, br.Zones(), settings, history, 0.0, 2.0, frame_no=7,
                      raw_boxes=raw, raw_scores=scores)
    assert [sorted(p["ids"][i] for i in g) for g in p["huddles"]] == [[-7002, 1, 2]]
    assert set(history) == {1, 2}           # only tracked birds have a history


def test_a_temporal_trio_never_reuses_a_bird_in_a_group():
    target = _record(2, 0.95)
    target = dict(target, huddles=[[0, 1, 3]], boxes=target["boxes"][:3] + [(108, 100, 10, 10)])
    ctx = [_record(0, 0.9), _record(1, 0.9), target, _record(3, 0.9), _record(4, 0.9)]
    clusters, _ = br.temporal_recover_huddles(target, ctx, ZONES)
    assert [origin for _, origin in clusters] == ["primary"]
