"""
Gap guard tests: klydel's own (hybridv2 behavior validation/test_gap_guard.py,
commit 9c6f755), same inputs and expected answers.

    cd packages/vision && python -m pytest tests/test_gap_guard.py -q
"""
import sys
from pathlib import Path

import numpy as np
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from gap_guard import iter_guarded_samples, parse_exclusions  # noqa: E402


def frame(v):
    a = np.zeros((96, 96, 3), dtype=np.uint8)
    a[:, :, :] = v
    return a


def read(samples, **kw):
    return list(iter_guarded_samples(samples, interval=2, **kw))


def test_normal_video():
    actual = read([(i * 2, i + 1, frame(i * 15)) for i in range(5)])
    assert [x.status for x in actual] == ["VALID"] * 5


def test_freeze_not_counted_as_observation():
    vals = [3, 10, 10, 10, 10, 20, 23]
    actual = read([(i * 2, i + 1, frame(v)) for i, v in enumerate(vals)])
    assert [x.status for x in actual] == ["VALID", "VALID", "GAP", "GAP", "GAP", "VALID", "VALID"]
    assert all(x.frame is None for x in actual if x.status == "GAP")


def test_two_identical_samples_are_not_automatically_frozen():
    vals = [2, 3, 3, 4]
    actual = read([(i * 2, i + 1, frame(v)) for i, v in enumerate(vals)])
    assert [x.status for x in actual] == ["VALID"] * 4


def test_timestamp_jump():
    actual = read([(0, 1, frame(1)), (2, 2, frame(2)), (25, 3, frame(3))])
    assert [x.status for x in actual] == ["VALID", "VALID", "GAP", "VALID"]
    assert actual[2].reason == "timestamp_jump"
    assert actual[2].time == 4


def test_manual_exclusion():
    actual = read([(i * 2, i + 1, frame(i * 10)) for i in range(5)], exclusions=[(2, 6)])
    assert [x.status for x in actual] == ["VALID", "GAP", "GAP", "VALID", "VALID"]


def test_bad_frame():
    actual = read([(0, 1, frame(1)), (2, 2, None), (4, 3, frame(2))])
    assert [x.status for x in actual] == ["VALID", "GAP", "VALID"]


def test_parse_exclusions():
    assert parse_exclusions(["00:41:02-00:46:19"]) == [(2462.0, 2779.0)]
    with pytest.raises(ValueError):
        parse_exclusions(["00:02:00-00:01:00"])
