"""
Unit tests for the uploaded-clip store.

Like the behaviour tests, these need no camera, model or database. They do need
a video file, so they write one: a handful of moving blocks encoded as MJPG AVI,
which every OpenCV build can produce without a codec pack.

    pip install pytest      # dev only, not in the service image
    cd packages/vision && python -m pytest tests -q
"""

import sys
from pathlib import Path
from types import SimpleNamespace

import cv2
import numpy as np
import pytest

# Modules in this service import each other by bare name ("import video"),
# which is how the container runs them, so put the package root on the path.
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import video  # noqa: E402


@pytest.fixture
def store(tmp_path, monkeypatch):
    """A private clip directory, so nothing lands in the container's /tmp."""
    monkeypatch.setattr(video, "STORE_DIR", str(tmp_path))
    video._clips.clear()
    yield tmp_path
    video._clips.clear()


def write_clip(path: Path, seconds: float = 2.0, fps: int = 10, moving: bool = True) -> Path:
    """A small clip: a white block crossing a grey frame, or a still one."""
    size = (120, 80)
    writer = cv2.VideoWriter(str(path), cv2.VideoWriter_fourcc(*"MJPG"), fps, size)
    assert writer.isOpened(), "this OpenCV build has no MJPG encoder"
    try:
        for i in range(int(seconds * fps)):
            frame = np.full((size[1], size[0], 3), 60, np.uint8)
            x = 10 + (i * 2 if moving else 0)
            cv2.rectangle(frame, (x, 20), (x + 20, 40), (255, 255, 255), -1)
            writer.write(frame)
    finally:
        writer.release()
    return path


def upload(path: Path, name: str | None = None) -> video.Clip:
    with open(path, "rb") as fh:
        return video.save(fh, name or path.name)


# ---------------------------------------------------------------------------
# Ingest
# ---------------------------------------------------------------------------

def test_accepted_clip_reports_its_own_numbers(store):
    clip = upload(write_clip(store / "sample.avi"))

    assert clip.fps == pytest.approx(10, rel=0.1)
    assert clip.duration == pytest.approx(2.0, abs=0.25)
    assert (clip.width, clip.height) == (120, 80)
    assert clip.bytes > 0
    # What the dashboard is told, not just what the runner keeps.
    assert clip.as_dict()["max_samples"] == video.MAX_SAMPLES
    assert video.get(clip.id) is clip


def test_a_percent_encoded_name_arrives_readable(store):
    # The name travels in a header, which cannot carry non-Latin-1, so the API
    # percent-encodes it. Storing the encoded form would show %20 in the list.
    clip = upload(write_clip(store / "sample.avi"), name="aso%27t%20manok%20(final).avi")

    assert clip.name == "aso't manok (final).avi"


def test_extension_is_only_a_hint_until_the_file_plays(store):
    # A renamed text file must be refused at upload, not halfway through a sweep.
    garbage = store / "not-really.mp4"
    garbage.write_bytes(b"this is not a video" * 100)

    with pytest.raises(video.ClipError) as err:
        upload(garbage)
    assert err.value.code == "unreadable_clip"
    assert err.value.status == 415


def test_refused_upload_leaves_nothing_behind(store):
    garbage = store / "not-really.mp4"
    garbage.write_bytes(b"this is not a video" * 100)

    with pytest.raises(video.ClipError):
        upload(garbage)

    assert list(store.iterdir()) == [garbage]  # only the file the test wrote
    assert video.count() == 0


def test_unknown_extension_is_refused_before_anything_is_written(store):
    note = store / "feeding-notes.txt"
    note.write_bytes(b"10:00 - all quiet")

    with pytest.raises(video.ClipError) as err:
        upload(note)
    assert err.value.code == "unsupported_type"
    assert err.value.status == 415


def test_empty_upload_is_refused(store):
    empty = store / "empty.mp4"
    empty.write_bytes(b"")

    with pytest.raises(video.ClipError) as err:
        upload(empty)
    assert err.value.code == "empty_upload"


def test_an_oversized_clip_is_cut_off_while_writing(store, monkeypatch):
    monkeypatch.setattr(video, "MAX_BYTES", 1024)
    big = store / "big.avi"
    big.write_bytes(b"\0" * 4096)

    with pytest.raises(video.ClipError) as err:
        upload(big)
    assert err.value.code == "too_large"
    assert err.value.status == 413
    # The partial copy must not be left to fill the disk.
    assert [p.name for p in store.iterdir()] == ["big.avi"]


def test_a_clip_longer_than_the_limit_is_refused(store, monkeypatch):
    monkeypatch.setattr(video, "MAX_SECONDS", 0.5)

    with pytest.raises(video.ClipError) as err:
        upload(write_clip(store / "long.avi", seconds=2.0))
    assert err.value.code == "too_long"


# ---------------------------------------------------------------------------
# Reading frames
# ---------------------------------------------------------------------------

def test_pair_returns_two_frames_a_delta_apart(store):
    clip = upload(write_clip(store / "moving.avi"))

    first, second = video.pair(clip, 0.2, delta_ms=300)
    assert first is not None and second is not None
    assert first.shape == second.shape
    # The block moved, so the frames must differ — this is what proves the
    # second frame is not a re-read of the first.
    assert not np.array_equal(first, second)


def test_pair_of_a_still_clip_is_identical(store):
    clip = upload(write_clip(store / "still.avi", moving=False))

    first, second = video.pair(clip, 0.2, delta_ms=300)
    assert first is not None and second is not None
    assert np.array_equal(first, second)


def test_pair_past_the_end_reports_nothing_rather_than_stillness(store):
    clip = upload(write_clip(store / "moving.avi"))

    first, second = video.pair(clip, clip.duration + 5, delta_ms=300)
    assert first is None and second is None


def test_frame_at_returns_one_frame(store):
    clip = upload(write_clip(store / "moving.avi"))

    frame = video.frame_at(clip, 1.0)
    assert frame is not None
    assert frame.shape == (80, 120, 3)
    assert video.frame_at(clip, clip.duration + 5) is None


def test_encode_jpeg_produces_a_jpeg(store):
    clip = upload(write_clip(store / "moving.avi"))

    jpeg = video.encode_jpeg(video.frame_at(clip, 0.5))
    assert jpeg is not None
    assert jpeg[:2] == b"\xff\xd8"


# ---------------------------------------------------------------------------
# Sample times
# ---------------------------------------------------------------------------

def test_sample_times_keep_clear_of_both_ends(store):
    clip = upload(write_clip(store / "moving.avi", seconds=10.0))

    times = video.sample_times(clip, count=5, delta_ms=700)
    assert len(times) == 5
    assert times == sorted(times)
    assert times[0] >= 0.5
    # The last one needs a delta of footage after it to be paired at all.
    assert times[-1] <= clip.duration - 0.7


def test_sample_times_of_a_single_sample_starts_at_the_margin(store):
    clip = upload(write_clip(store / "moving.avi", seconds=10.0))

    assert video.sample_times(clip, count=1, delta_ms=700) == [0.5]


def test_sample_times_of_a_clip_shorter_than_a_pair_take_the_middle(store):
    clip = upload(write_clip(store / "tiny.avi", seconds=0.5))

    times = video.sample_times(clip, count=8, delta_ms=700)
    assert len(times) == 1
    assert times[0] == pytest.approx(clip.duration / 2, abs=0.05)


def test_sample_times_never_exceed_the_configured_maximum(store):
    clip = upload(write_clip(store / "moving.avi", seconds=10.0))

    assert len(video.sample_times(clip, count=500, delta_ms=700)) == video.MAX_SAMPLES


# ---------------------------------------------------------------------------
# Lifecycle
# ---------------------------------------------------------------------------

def test_remove_forgets_the_clip_and_its_file(store):
    clip = upload(write_clip(store / "moving.avi"))
    path = Path(clip.path)
    assert path.exists()

    assert video.remove(clip.id) is True
    assert video.get(clip.id) is None
    assert not path.exists()


def test_removing_a_clip_twice_reports_the_second_as_missing(store):
    clip = upload(write_clip(store / "moving.avi"))

    assert video.remove(clip.id) is True
    assert video.remove(clip.id) is False


def test_expired_clips_are_dropped_on_the_next_look(store, monkeypatch):
    clip = upload(write_clip(store / "moving.avi"))
    monkeypatch.setattr(video, "TTL_SECONDS", -1.0)  # everything is already stale

    assert video.purge_expired() == 1
    assert video.get(clip.id) is None


# ---------------------------------------------------------------------------
# Drawing
# ---------------------------------------------------------------------------

def test_annotate_draws_without_touching_the_input(store):
    frame = np.full((80, 120, 3), 60, np.uint8)
    detection = SimpleNamespace(
        box_x=10, box_y=10, box_w=20, box_h=20,
        behavior="inactive", flag=None, zone=None,
    )

    out = video.annotate(frame, [detection])
    assert np.array_equal(frame, np.full((80, 120, 3), 60, np.uint8))  # untouched
    assert not np.array_equal(out, frame)                                # something drawn


def test_annotate_with_nothing_found_leaves_the_picture_alone(store):
    frame = np.full((80, 120, 3), 60, np.uint8)
    assert np.array_equal(video.annotate(frame, []), frame)
