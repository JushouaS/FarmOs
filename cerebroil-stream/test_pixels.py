"""Tests for pixels.py: python -m unittest test_pixels   (from the cerebroil-stream folder; needs numpy and OpenCV)."""
import unittest

import numpy as np

import pixels


def picture(seed=0):
    rng = np.random.default_rng(seed)
    base = np.full((200, 200), 90, dtype=np.uint8)
    base[40:100, 40:100] = 200      # a bird
    base[120:180, 120:180] = 160    # another
    return np.clip(base + rng.integers(-3, 4, base.shape), 0, 255).astype(np.uint8)


BIRD = [40, 40, 60, 60]
OTHER = [120, 120, 60, 60]


class UnchangedShares(unittest.TestCase):
    def test_the_same_picture_is_all_unchanged(self):
        shares = pixels.unchanged_shares(pixels.to_gray(picture(1)), pixels.to_gray(picture(2)), [BIRD, OTHER])
        self.assertTrue(all(s is not None and s >= 0.99 for s in shares))

    def test_a_bird_that_moved_is_reported_as_changed_and_the_other_is_not(self):
        now = picture(2)
        now[40:100, 40:100] = 90         # the bird left its place
        now[40:100, 100:160] = 200       # ... and stands further along
        shares = pixels.unchanged_shares(pixels.to_gray(picture(1)), pixels.to_gray(now), [BIRD, OTHER])
        self.assertLess(shares[0], 0.5)
        self.assertGreaterEqual(shares[1], 0.99)

    def test_a_change_in_the_brightness_of_the_whole_picture_is_not_movement(self):
        brighter = np.clip(picture(2).astype(int) + 40, 0, 255).astype(np.uint8)
        shares = pixels.unchanged_shares(pixels.to_gray(picture(1)), pixels.to_gray(brighter), [BIRD, OTHER])
        self.assertTrue(all(s >= 0.99 for s in shares))

    def test_nothing_to_compare_gives_none(self):
        gray = pixels.to_gray(picture())
        self.assertEqual(pixels.unchanged_shares(None, gray, [BIRD]), [None])
        self.assertEqual(pixels.unchanged_shares(np.zeros((10, 10), np.uint8), gray, [BIRD]), [None])  # other size
        self.assertEqual(pixels.unchanged_shares(gray, gray, [[5, 5, 3, 3], [500, 500, 20, 20]]), [None, None])  # tiny, outside

    def test_a_box_that_overhangs_the_picture_is_clamped(self):
        gray = pixels.to_gray(picture())
        share = pixels.unchanged_shares(gray, gray, [[150, 150, 100, 100]])[0]
        self.assertEqual(share, 1.0)


if __name__ == "__main__":
    unittest.main()
