"""Tests for bytetrack.py: python -m unittest test_bytetrack   (from the cerebroil-stream folder; standard library only)."""
import itertools
import random
import unittest

import behavior
import bytetrack

AREA = 1000.0 * 1000.0


def box(x, y, conf=0.9, size=40.0):
    return [x, y, size, size, conf, 0]


def ids_over(frames, gap):
    """Runs the engine over `frames` (a list of box lists, one per picture) and returns the bird numbers given in each."""
    engine = behavior.Engine(inactive_seconds=60, huddle_seconds=600, keep_all=False)
    return [[tid for tid, _ in engine.update(k * gap, boxes, AREA)] for k, boxes in enumerate(frames)], engine


class Hungarian(unittest.TestCase):
    def best(self, cost):
        n, m = len(cost), len(cost[0])
        if n <= m:
            return min(sum(cost[i][p[i]] for i in range(n)) for p in itertools.permutations(range(m), n))
        return min(sum(cost[p[j]][j] for j in range(m)) for p in itertools.permutations(range(n), m))

    def test_it_finds_the_cheapest_assignment_for_square_wide_and_tall_matrices(self):
        rng = random.Random(1)
        for n, m in [(3, 3), (4, 4), (2, 5), (5, 2), (1, 3), (3, 1), (4, 6)]:
            for _ in range(20):
                cost = [[rng.random() for _ in range(m)] for _ in range(n)]
                pairs = bytetrack.hungarian(cost)
                self.assertEqual(len(pairs), min(n, m))
                self.assertEqual(len({r for r, _ in pairs}), len(pairs))
                self.assertEqual(len({c for _, c in pairs}), len(pairs))
                self.assertAlmostEqual(sum(cost[r][c] for r, c in pairs), self.best(cost), places=9)

    def test_nothing_to_assign(self):
        self.assertEqual(bytetrack.hungarian([]), [])
        self.assertEqual(bytetrack.hungarian([[]]), [])


class Kalman(unittest.TestCase):
    def test_it_learns_a_constant_speed_and_predicts_the_next_position(self):
        kf = bytetrack.BoxKalman(100, 100, 40, 40)
        for k in range(1, 12):
            kf.predict(1.0)
            kf.update(100 + 10 * k, 100, 40, 40)
        kf.predict(1.0)
        self.assertAlmostEqual(kf.box[0], 100 + 10 * 12, delta=1.5)
        self.assertAlmostEqual(kf.box[1], 100, delta=1.0)

    def test_a_bird_standing_still_is_predicted_where_it_is(self):
        kf = bytetrack.BoxKalman(300, 200, 50, 40)
        for _ in range(10):
            kf.predict(1.0)
            kf.update(300, 200, 50, 40)
        kf.predict(3.0)
        self.assertAlmostEqual(kf.box[0], 300, delta=0.5)
        self.assertAlmostEqual(kf.box[2], 50, delta=0.5)


class Following(unittest.TestCase):
    def test_a_bird_whose_confidence_dips_keeps_its_number(self):
        # The second association: a weak detection is matched to the bird it belongs to instead of starting a new one.
        frames = [[box(100, 100, 0.9), box(400, 100, 0.9)]] * 5 + [[box(100, 100, 0.3), box(400, 100, 0.9)]] * 5 + [[box(100, 100, 0.9), box(400, 100, 0.9)]] * 5
        ids, engine = ids_over(frames, 0.5)
        self.assertEqual(engine.next_id - 1, 2)
        self.assertEqual(ids[0], ids[7])

    def test_a_bird_missed_for_a_moment_keeps_its_number(self):
        frames = [[box(100, 100), box(400, 100)]] * 4 + [[box(400, 100)]] * 2 + [[box(100, 100), box(400, 100)]] * 4
        ids, engine = ids_over(frames, 0.5)    # missed for 1 second: inside the buffer
        self.assertEqual(engine.next_id - 1, 2)
        self.assertEqual(ids[0][0], ids[-1][0])

    def test_two_birds_that_cross_paths_keep_their_numbers(self):
        # Moving in opposite directions along one row: only the predicted positions tell them apart while they overlap.
        frames = [[box(100 + 12 * k, 200), box(500 - 12 * k, 200)] for k in range(34)]
        ids, engine = ids_over(frames, 0.25)
        self.assertEqual(engine.next_id - 1, 2)
        self.assertEqual(ids[0], ids[-1])

    def test_a_bird_walking_between_pictures_three_seconds_apart_keeps_its_number(self):
        # Pictures this far apart: the boxes hardly overlap, so the distance pass has to hold on to it.
        frames = [[box(100 + 30 * k, 300), box(700, 600)] for k in range(20)]
        ids, engine = ids_over(frames, 3.0)
        self.assertEqual(engine.next_id - 1, 2)

    def test_a_new_bird_appearing_gets_a_new_number(self):
        frames = [[box(100, 100)]] * 3 + [[box(100, 100), box(500, 500)]] * 3
        ids, engine = ids_over(frames, 0.5)
        self.assertEqual(engine.next_id - 1, 2)
        self.assertNotEqual(ids[-1][0], ids[-1][1])


class Associations(unittest.TestCase):
    """bytetrack.match on its own, with the distance pass switched off (gate=-1) so only ByteTrack's two passes can match."""

    def track(self, last_t):
        trk = behavior._Track(1, (100.0, 100.0, 40.0, 40.0), last_t)
        trk.last_t = last_t
        return trk

    def test_a_weak_detection_is_matched_to_a_bird_seen_in_the_previous_picture(self):
        matched, fresh = bytetrack.match([self.track(0.0)], [(100.0, 100.0, 40.0, 40.0)], [0.3], 0.5, 0.5, 0.0, gate=-1)
        self.assertEqual((matched, fresh), ({0: 0}, set()))

    def test_a_weak_detection_does_not_revive_a_bird_that_was_already_lost(self):
        # ByteTrack's second association only looks at birds that were seen in the previous picture.
        matched, fresh = bytetrack.match([self.track(-2.0)], [(100.0, 100.0, 40.0, 40.0)], [0.3], 0.5, 0.5, 0.0, gate=-1)
        self.assertEqual((matched, fresh), ({}, {0}))

    def test_a_confident_detection_does_revive_a_lost_bird(self):
        matched, fresh = bytetrack.match([self.track(-2.0)], [(100.0, 100.0, 40.0, 40.0)], [0.9], 0.5, 0.5, 0.0, gate=-1)
        self.assertEqual((matched, fresh), ({0: 0}, set()))

    def test_confident_detections_are_matched_before_weak_ones(self):
        # Two detections on one bird: the confident one takes it and the weak one becomes a new bird.
        dets = [(100.0, 100.0, 40.0, 40.0), (104.0, 100.0, 40.0, 40.0)]
        matched, fresh = bytetrack.match([self.track(0.0)], dets, [0.3, 0.9], 0.5, 0.5, 0.0, gate=-1)
        self.assertEqual((matched, fresh), ({1: 0}, {0}))


if __name__ == "__main__":
    unittest.main()
