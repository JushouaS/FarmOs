"""
Unit tests for the depth-to-mass estimation of uploaded clips.

No camera, model or database needed. The numbers the live Kinect station
produces are the reference: these tests pin the clip path to the same line
(K0 − K1 × mean ROI intensity) so a test clip answers what the live path
would.

    pip install pytest      # dev only, not in the service image
    cd packages/vision && python -m pytest tests -q
"""

import sys
from pathlib import Path

import numpy as np
import pytest

# Modules in this service import each other by bare name ("import weight"),
# which is how the container runs them, so put the package root on the path.
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import video  # noqa: E402
import weight  # noqa: E402


def flat_frame(intensity: int, size: tuple[int, int] = (100, 100)) -> np.ndarray:
    """A depth-colormap frame of one even intensity: an empty or full platform."""
    return np.full((size[1], size[0], 3), intensity, np.uint8)


# ---------------------------------------------------------------------------
# One frame
# ---------------------------------------------------------------------------

def test_a_mid_band_frame_matches_the_live_line():
    # 2400 − 100 × 9.5 = 1450.0, the same number the live station would report.
    estimate = weight.estimate_weight_from_depth(flat_frame(100))
    assert estimate == {"mass_g": 1450.0, "confidence": weight.PER_FRAME_CONFIDENCE}


def test_the_border_of_the_frame_is_not_weighed():
    # A bright frame with a dark centre: the live path reads the centre 50%,
    # so the border must not move the answer off 1450.0.
    frame = flat_frame(200)
    frame[25:75, 25:75] = 100
    assert weight.estimate_weight_from_depth(frame)["mass_g"] == 1450.0


def test_an_empty_platform_clamps_at_zero_rather_than_going_negative():
    # 2400 − 255 × 9.5 is negative; an empty platform is 0 g, not minus grams.
    assert weight.estimate_weight_from_depth(flat_frame(255))["mass_g"] == 0.0


def test_no_frame_is_no_reading():
    assert weight.estimate_weight_from_depth(None) is None


def test_a_greyscale_frame_is_read_the_same_as_a_colormap_one():
    gray = np.full((100, 100), 100, np.uint8)
    assert weight.estimate_weight_from_depth(gray)["mass_g"] == 1450.0


# ---------------------------------------------------------------------------
# The clip's headline
# ---------------------------------------------------------------------------

def samples(*masses: float) -> list[dict]:
    return [{"t": i, "mass_g": m, "confidence": 0.55} for i, m in enumerate(masses)]


def test_summarize_reports_real_median_spread_and_range():
    summary = weight.summarize(samples(1000.0, 1400.0, 1800.0))

    assert summary["median_g"] == 1400.0
    assert summary["min_g"] == 1000.0
    assert summary["max_g"] == 1800.0
    assert summary["samples"] == 3
    assert summary["confidence"] == 0.55
    # Population spread of {1000, 1400, 1800} against their mean.
    assert summary["std_dev_g"] == pytest.approx(400.0, abs=0.1)


def test_summarize_of_one_sample_has_no_spread():
    summary = weight.summarize(samples(1450.0))
    assert summary["median_g"] == 1450.0
    assert summary["std_dev_g"] == 0.0
    assert summary["samples"] == 1


def test_unreadable_frames_are_left_out_not_counted_as_empty():
    # A frame that could not be decoded is a missing sample, not 0 g; it must
    # not drag the median down or the range out.
    rows = samples(1400.0, 1500.0)
    rows.insert(1, {"t": 0.5, "mass_g": None, "confidence": None, "warnings": ["video_frame_unavailable"]})

    summary = weight.summarize(rows)
    assert summary["samples"] == 2
    assert summary["median_g"] == 1450.0
    assert summary["min_g"] == 1400.0
    assert summary["max_g"] == 1500.0


def test_summarize_of_nothing_reports_nothing():
    summary = weight.summarize([])
    assert summary == {
        "median_g": None,
        "std_dev_g": None,
        "min_g": None,
        "max_g": None,
        "samples": 0,
        "confidence": None,
    }


# ---------------------------------------------------------------------------
# Sampling
# ---------------------------------------------------------------------------

@pytest.fixture
def clip(tmp_path, monkeypatch):
    """A short, still clip: one even intensity per frame is all a weight needs."""
    monkeypatch.setattr(video, "STORE_DIR", str(tmp_path))
    video._clips.clear()

    import cv2

    path = tmp_path / "depth.avi"
    writer = cv2.VideoWriter(str(path), cv2.VideoWriter_fourcc(*"MJPG"), 10, (120, 80))
    assert writer.isOpened(), "this OpenCV build has no MJPG encoder"
    try:
        for _ in range(60):
            writer.write(np.full((80, 120, 3), 100, np.uint8))
    finally:
        writer.release()

    with open(path, "rb") as fh:
        saved = video.save(fh, path.name)
    yield saved
    video._clips.clear()


def test_a_depth_clip_can_take_more_samples_than_a_sweep(clip):
    # The weights pass reads one frame per sample, so its cap is weight's, not
    # the sweep's.
    times = video.sample_times(clip, count=60, delta_ms=0, max_samples=weight.MAX_SAMPLES)
    assert len(times) == weight.MAX_SAMPLES


def test_every_sample_of_an_even_depth_clip_agrees_with_the_live_line(clip):
    # The clip is written at intensity 100, which the live line prices at
    # 1450 g (2400 − 100 × 9.5). MJPG is lossy, though, so a frame can decode at
    # 99 instead — and one intensity step is 9.5 g, so demanding exactly 1450.0
    # would be asserting that the encoder is lossless, not that the clip path
    # uses the live formula. What this pins down is the thing that matters:
    # every sample is priced by the same line, within a couple of intensity
    # steps of it, rather than by an implementation of its own.
    times = video.sample_times(clip, count=12, delta_ms=0, max_samples=weight.MAX_SAMPLES)

    estimates = [weight.estimate_weight_from_depth(video.frame_at(clip, t)) for t in times]
    assert all(e is not None for e in estimates)
    summary = weight.summarize(estimates)
    assert summary["samples"] == len(times)
    # Two intensity steps either way.
    assert 1450.0 - 19.0 <= summary["min_g"] <= 1450.0 + 19.0
    assert 1450.0 - 19.0 <= summary["max_g"] <= 1450.0 + 19.0
    # And the samples must agree with each other: a spread wider than that is
    # an encoder effect large enough to hide a different formula.
    assert summary["max_g"] - summary["min_g"] <= 19.0


# ---------------------------------------------------------------------------
# Is it a depth recording at all?
# ---------------------------------------------------------------------------

def colormapped(code, size=(120, 80)):
    """A depth frame drawn with a colormap: a spread of depths, a little noise."""
    import cv2

    rng = np.random.default_rng(0)
    ramp = np.tile(np.linspace(20, 235, size[0], dtype=np.float32), (size[1], 1))
    depth = np.clip(ramp + rng.normal(0, 3, ramp.shape), 0, 255).astype(np.uint8)
    return cv2.applyColorMap(depth, code)


def colour_footage(size=(120, 80)):
    """Ordinary colour footage of the pen: sawdust, a red mat, green netting, pale birds (colours measured on the real footage)."""
    frame = np.zeros((size[1], size[0], 3), np.uint8)
    frame[:, :40] = (112, 150, 182)        # sawdust (BGR)
    frame[:, 40:80] = (70, 70, 190)        # red mat
    frame[:, 80:] = (80, 140, 60)          # green netting
    frame[30:50, 20:100] = (205, 215, 225)  # pale birds
    return frame


def test_grey_and_colormapped_depth_frames_look_like_depth():
    import cv2

    assert weight.looks_like_depth(np.full((80, 120), 100, np.uint8))
    assert weight.looks_like_depth(flat_frame(100))
    assert weight.looks_like_depth(colormapped(cv2.COLORMAP_TURBO))
    assert weight.looks_like_depth(colormapped(cv2.COLORMAP_JET))


def test_ordinary_colour_footage_does_not_look_like_depth():
    assert not weight.looks_like_depth(colour_footage())


def test_no_frame_does_not_look_like_depth():
    assert not weight.looks_like_depth(None)


def _post_weights(clip_id):
    import app as service

    client = service.app.test_client()
    return client.post(f"/video/{clip_id}/weights?count=6", headers={"X-Vision-Token": service.SERVICE_TOKEN})


def _clip_of(tmp_path, monkeypatch, frame):
    import cv2

    monkeypatch.setattr(video, "STORE_DIR", str(tmp_path))
    video._clips.clear()
    path = tmp_path / "c.avi"
    writer = cv2.VideoWriter(str(path), cv2.VideoWriter_fourcc(*"MJPG"), 10, (frame.shape[1], frame.shape[0]))
    for _ in range(40):
        writer.write(frame)
    writer.release()
    with open(path, "rb") as fh:
        return video.save(fh, path.name)


def test_a_colour_video_is_refused_instead_of_being_weighed(tmp_path, monkeypatch):
    clip = _clip_of(tmp_path, monkeypatch, colour_footage())
    response = _post_weights(clip.id)
    assert response.status_code == 422
    assert response.get_json()["error"] == "not_depth_recording"
    video._clips.clear()


def test_a_colormapped_depth_video_is_weighed(tmp_path, monkeypatch):
    import cv2

    clip = _clip_of(tmp_path, monkeypatch, colormapped(cv2.COLORMAP_TURBO))
    response = _post_weights(clip.id)
    assert response.status_code == 200
    assert response.get_json()["summary"]["samples"] == 6
    video._clips.clear()
