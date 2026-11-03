"""Tests for behavior.py: python -m unittest test_behavior   (from the cerebroil-stream folder; needs only the standard library).

Birds are 40 x 40 boxes in a 1000 x 1000 picture, seen twice a second.
"""
import unittest

import behavior

AREA = 1000.0 * 1000.0
SIZE = 40.0


def box(x, y):
    return [x, y, SIZE, SIZE, 0.9, 0]


def spread(n, shift=0.0):
    """n birds on a loose grid far apart, all moved sideways by `shift`."""
    return [box(60 + (i % 5) * 180 + shift, 60 + (i // 5) * 180) for i in range(n)]


def run(engine, seconds, make_boxes, night=False, fps=2):
    for k in range(int(seconds * fps)):
        engine.update(k / fps, make_boxes(k / fps), AREA, night)


class Inactivity(unittest.TestCase):
    def test_a_bird_that_stays_still_while_the_rest_move_is_flagged_by_day_only(self):
        def boxes(t):
            moving = spread(9, shift=t * 60)          # nine birds that keep walking
            still = [box(700, 700)]                   # one that does not
            return moving + still

        day = behavior.Engine(inactive_seconds=5)
        run(day, 14, boxes)
        flagged = day.status(night=False)["inactive"]
        self.assertEqual(len(flagged), 1)
        self.assertGreaterEqual(flagged[0]["still_seconds"], 5)
        self.assertIsNone(day.status(night=False)["flock_inactive"])
        # The same picture at night is a bird asleep: nothing to flag.
        self.assertEqual(day.status(night=True)["inactive"], [])

    def test_birds_that_keep_moving_are_never_flagged(self):
        engine = behavior.Engine(inactive_seconds=5)
        run(engine, 14, lambda t: spread(10, shift=t * 60))
        status = engine.status(night=False)
        self.assertEqual(status["inactive"], [])
        self.assertIsNone(status["flock_inactive"])
        self.assertEqual(status["birds"], 10)

    def test_a_whole_flock_that_stops_by_day_is_a_flock_alert_not_ten_bird_alerts(self):
        engine = behavior.Engine(inactive_seconds=5)
        run(engine, 14, lambda t: spread(10))
        status = engine.status(night=False)
        self.assertIsNotNone(status["flock_inactive"])
        self.assertEqual(status["inactive"], [])
        self.assertIsNone(engine.status(night=True)["flock_inactive"])


def clump(n, cx=500.0, cy=500.0):
    """n birds packed together, touching."""
    return [box(cx + (i % 4) * (SIZE - 4), cy + (i // 4) * (SIZE - 4)) for i in range(n)]


class Huddling(unittest.TestCase):
    def test_a_packed_group_is_one_huddle_in_a_single_picture(self):
        groups = behavior.snapshot_huddles(clump(8) + spread(4), AREA)
        self.assertEqual(len(groups), 1)
        self.assertEqual(groups[0]["birds"], 8)

    def test_fewer_birds_than_the_minimum_are_not_a_huddle(self):
        self.assertEqual(behavior.snapshot_huddles(clump(4), AREA), [])

    def test_a_uniformly_crowded_house_is_not_a_huddle(self):
        # 400 birds side by side across the whole picture: the group is no denser than the flock overall.
        grid = [box(10 + (i % 20) * 48, 10 + (i // 20) * 48) for i in range(400)]
        self.assertEqual(behavior.snapshot_huddles(grid, AREA), [])

    def test_a_huddle_counts_only_after_it_stays_together(self):
        engine = behavior.Engine(huddle_seconds=6, inactive_seconds=60)
        run(engine, 3, lambda t: clump(8) + spread(4))
        self.assertIsNone(engine.status(night=False)["huddle"])  # together for three seconds: not yet
        run_more = behavior.Engine(huddle_seconds=6, inactive_seconds=60)
        run(run_more, 10, lambda t: clump(8) + spread(4))
        huddle = run_more.status(night=False)["huddle"]
        self.assertIsNotNone(huddle)
        self.assertGreaterEqual(huddle["birds"], 5)
        self.assertGreater(huddle["fdi"], 0)


if __name__ == "__main__":
    unittest.main()
