"""
Unit tests for the behaviour measurements.

These run without a camera, a model or a database — that is the point of
keeping behaviour.py pure. The thresholds here are the ones that decide
whether a farmer gets told his flock is huddling, so they get tests rather
than a hope that the numbers look right on screen.

    pip install pytest      # dev only, not in the service image
    cd packages/vision && python -m pytest tests -q
"""

import sys
from pathlib import Path

import numpy as np

# Modules in this service import each other by bare name ("import behavior"),
# which is how the container runs them, so put the package root on the path.
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import behavior as bz  # noqa: E402


# ---------------------------------------------------------------------------
# point_in_polygon
# ---------------------------------------------------------------------------

SQUARE = [[0.2, 0.2], [0.8, 0.2], [0.8, 0.8], [0.2, 0.8]]


def test_point_inside_square():
    assert bz.point_in_polygon(0.5, 0.5, SQUARE) is True


def test_point_outside_square():
    assert bz.point_in_polygon(0.1, 0.5, SQUARE) is False
    assert bz.point_in_polygon(0.5, 0.95, SQUARE) is False


def test_point_just_inside_and_outside_edge():
    assert bz.point_in_polygon(0.201, 0.5, SQUARE) is True
    assert bz.point_in_polygon(0.199, 0.5, SQUARE) is False


def test_concave_polygon_notch_is_outside():
    # A "U": the gap between the arms must not count as inside just because a
    # ray from it crosses the shape more than once.
    u_shape = [
        [0.1, 0.1], [0.9, 0.1], [0.9, 0.9], [0.7, 0.9],
        [0.7, 0.3], [0.3, 0.3], [0.3, 0.9], [0.1, 0.9],
    ]
    assert bz.point_in_polygon(0.5, 0.6, u_shape) is False  # in the gap
    assert bz.point_in_polygon(0.2, 0.6, u_shape) is True   # in the left arm


def test_degenerate_polygon_is_never_inside():
    assert bz.point_in_polygon(0.5, 0.5, []) is False
    assert bz.point_in_polygon(0.5, 0.5, [[0.1, 0.1], [0.9, 0.9]]) is False


def test_points_outside_normalised_range_do_not_match():
    assert bz.point_in_polygon(1.5, 0.5, SQUARE) is False


# ---------------------------------------------------------------------------
# zone_mask
# ---------------------------------------------------------------------------

def test_zone_mask_marks_only_birds_at_the_feeder():
    boxes = [
        bz.Box(45, 45, 10, 10),   # centre (50, 50) -> inside
        bz.Box(5, 5, 10, 10),     # far away
    ]
    mask = bz.zone_mask(boxes, [SQUARE], 100, 100)
    assert mask == [True, False]


def test_zone_mask_without_zones_is_all_false():
    boxes = [bz.Box(45, 45, 10, 10)]
    assert bz.zone_mask(boxes, [], 100, 100) == [False]


def test_zone_mask_foot_anchor_catches_bird_leaning_over_the_trough():
    # Polygon covers the bottom of the frame. The bird's centre is above it,
    # its feet are on it — for an angled camera the feet are the honest answer.
    trough = [[0.0, 0.5], [1.0, 0.5], [1.0, 0.9], [0.0, 0.9]]
    boxes = [bz.Box(40, 42, 10, 10)]  # centre y=47, foot y=52

    assert bz.zone_mask(boxes, [trough], 100, 100, anchor="centre") == [False]
    assert bz.zone_mask(boxes, [trough], 100, 100, anchor="foot") == [True]


def test_zone_mask_survives_a_resolution_change():
    # Same scene at 1920x1080 and at 1280x720: normalised polygons must give
    # the same verdict, or a camera that reconnects at another size silently
    # loses its zones.
    big = bz.zone_mask([bz.Box(864, 486, 192, 108)], [SQUARE], 1920, 1080)
    small = bz.zone_mask([bz.Box(576, 324, 128, 72)], [SQUARE], 1280, 720)
    assert big == small == [True]


# ---------------------------------------------------------------------------
# box_motions
# ---------------------------------------------------------------------------

def test_motion_counts_pixels_that_changed_inside_the_box():
    before = np.zeros((60, 60), np.uint8)
    after = before.copy()
    after[13:27, 13:27] = 255  # entirely within the 15% inset of a 20px box

    motions = bz.box_motions(before, after, [bz.Box(10, 10, 20, 20)])
    assert motions[0] > 0.9  # whole sample area flipped


def test_motion_ignores_jitter_at_the_box_edge():
    # NMS nudges boxes by a pixel or two between frames. If the diff included
    # the rim, every bird would look active all the time.
    before = np.zeros((60, 60), np.uint8)
    after = before.copy()
    after[10:13, 10:30] = 255   # top rim
    after[27:30, 10:30] = 255   # bottom rim

    motions = bz.box_motions(before, after, [bz.Box(10, 10, 20, 20)])
    assert motions[0] == 0.0


def test_motion_of_identical_frames_is_zero():
    frame = np.full((40, 40), 128, np.uint8)
    assert bz.box_motions(frame, frame.copy(), [bz.Box(5, 5, 20, 20)])[0] == 0.0


def test_motion_clamps_a_box_that_overhangs_the_frame():
    before = np.zeros((40, 40), np.uint8)
    after = np.full((40, 40), 255, np.uint8)
    motions = bz.box_motions(before, after, [bz.Box(30, 30, 40, 40)])
    assert len(motions) == 1
    assert motions[0] > 0.9


def test_motion_of_a_speck_box_is_claimed_as_still():
    before = np.zeros((40, 40), np.uint8)
    after = np.full((40, 40), 255, np.uint8)
    # 3px box leaves less than 2px after the inset; there is nothing honest
    # to measure, so it must not invent movement.
    assert bz.box_motions(before, after, [bz.Box(5, 5, 3, 3)])[0] == 0.0


def test_count_inactive_uses_the_threshold():
    motions = [0.0, 0.001, 0.003, 0.01, 0.2]
    assert bz.count_inactive(motions, threshold=0.004) == 3


# ---------------------------------------------------------------------------
# cluster_huddling
# ---------------------------------------------------------------------------

def ring(count: int, cx: float, cy: float, radius: float, size: float = 20.0) -> list[bz.Box]:
    """`count` birds on a circle of the given radius."""
    angles = np.linspace(0, 2 * np.pi, count, endpoint=False)
    return [
        bz.Box(cx + radius * np.cos(a) - size / 2, cy + radius * np.sin(a) - size / 2, size, size)
        for a in angles
    ]


def test_tight_ring_is_a_huddle():
    result = bz.cluster_huddling(ring(6, 300, 300, radius=12))
    assert sum(result.huddled) == 6
    assert len(result.clusters) == 1
    assert result.risk > 0.5


def test_scattered_birds_are_not_huddling():
    spread = [bz.Box(100 * i, 100 * i, 20, 20) for i in range(6)]
    result = bz.cluster_huddling(spread)
    assert sum(result.huddled) == 0
    assert result.clusters == []
    assert result.risk == 0.0


def test_fewer_than_five_birds_is_never_a_cluster():
    # Four birds packed shoulder to shoulder are just four birds.
    result = bz.cluster_huddling(ring(4, 300, 300, radius=8))
    assert sum(result.huddled) == 0


def test_radius_scales_with_bird_size():
    # Same layout, twice the bird: a fixed pixel radius would call the big
    # ones huddling and the small ones not, which is backwards. Scaling by the
    # median width should give the same verdict at both sizes.
    small = ring(6, 300, 300, radius=12, size=20)
    big = ring(6, 300, 300, radius=24, size=40)
    assert bz.cluster_huddling(small).clusters != []
    assert bz.cluster_huddling(big).clusters != []


def test_huddle_radius_is_reported_for_calibration():
    result = bz.cluster_huddling(ring(6, 300, 300, radius=12, size=20))
    assert result.radius == round(20 * 1.3, 1)


def test_two_separate_clumps_are_two_clusters():
    birds = ring(5, 100, 100, radius=8) + ring(5, 900, 900, radius=8)
    result = bz.cluster_huddling(birds)
    assert len(result.clusters) == 2
    assert sum(result.huddled) == 10


def test_empty_frame_is_not_a_huddle():
    result = bz.cluster_huddling([])
    assert result.huddled == []
    assert result.risk == 0.0
