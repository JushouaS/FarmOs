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


# ---------------------------------------------------------------------------
# Rough weights from an ordinary colour picture (size of each bird's box)
# ---------------------------------------------------------------------------

FRAME = (1280, 720)


def test_equal_isolated_birds_all_get_the_typed_average():
    boxes = [(100, 100, 60, 60), (400, 100, 60, 60), (700, 300, 60, 60)]
    result = weight.size_weights(boxes, FRAME, 1100.0)
    assert [b["weight_g"] for b in result["birds"]] == [1100.0, 1100.0, 1100.0]
    assert result["summary"]["weighed"] == 3 and result["summary"]["spread_percent"] == 0.0


def test_a_bigger_bird_weighs_more_and_the_weighed_birds_average_the_typed_value():
    # Twice the area is 2 ** 1.5 = 2.83 times the mass.
    boxes = [(100, 100, 60, 60), (400, 100, 120, 60)]
    result = weight.size_weights(boxes, FRAME, 1000.0)
    small, big = (b["weight_g"] for b in result["birds"])
    assert big / small == pytest.approx(2 ** 1.5, rel=0.01)
    assert (small + big) / 2 == pytest.approx(1000.0, abs=0.2)


def test_a_bird_overlapped_by_another_is_shown_but_not_weighed_or_counted_in_the_average():
    boxes = [(100, 100, 60, 60), (130, 100, 60, 60), (600, 300, 60, 60)]
    result = weight.size_weights(boxes, FRAME, 1100.0)
    assert [b["reason"] for b in result["birds"]] == ["overlaps_another_bird", "overlaps_another_bird", None]
    assert [b["weight_g"] for b in result["birds"]] == [None, None, 1100.0]
    assert result["summary"]["weighed"] == 1 and result["summary"]["birds"] == 3


def test_a_bird_cut_by_the_edge_of_the_picture_is_not_weighed():
    boxes = [(0, 100, 60, 60), (600, 300, 60, 60)]
    result = weight.size_weights(boxes, FRAME, 1100.0)
    assert result["birds"][0]["reason"] == "cut_by_edge" and result["birds"][0]["weight_g"] is None
    assert result["birds"][1]["weight_g"] == 1100.0


def test_no_birds_or_no_isolated_birds_weighs_nothing():
    assert weight.size_weights([], FRAME, 1100.0)["summary"]["weighed"] == 0
    crowded = weight.size_weights([(100, 100, 60, 60), (120, 100, 60, 60)], FRAME, 1100.0)
    assert crowded["summary"]["weighed"] == 0 and crowded["summary"]["mean_g"] is None


class _StubDetector:
    available = True
    load_error = None

    def detect(self, frame):
        import detector

        return [
            detector.Detection(box_x=10, box_y=10, box_w=20, box_h=20, confidence=0.9),
            detector.Detection(box_x=60, box_y=40, box_w=30, box_h=20, confidence=0.9),
        ]


def _post_bird_weights(clip_id, query):
    import app as service

    client = service.app.test_client()
    return client.post(f"/video/{clip_id}/bird-weights?{query}", headers={"X-Vision-Token": service.SERVICE_TOKEN})


def test_the_bird_weights_route_needs_a_believable_average_weight(tmp_path, monkeypatch):
    clip = _clip_of(tmp_path, monkeypatch, colour_footage())
    for query in ("t=1&mean_g=abc", "t=1&mean_g=5", "t=1&mean_g=99999"):
        response = _post_bird_weights(clip.id, query)
        assert response.status_code == 400, query
        assert response.get_json()["error"] == "invalid_mean_weight"
    video._clips.clear()


def test_the_bird_weights_route_returns_each_bird_and_the_picture_with_the_weights_drawn(tmp_path, monkeypatch):
    import app as service

    clip = _clip_of(tmp_path, monkeypatch, colour_footage())
    monkeypatch.setattr(service, "detector", _StubDetector())
    response = _post_bird_weights(clip.id, "t=1&mean_g=1100")
    assert response.status_code == 200
    body = response.get_json()
    assert body["method"] == "size" and body["mean_g"] == 1100.0
    assert [b["weight_g"] is not None for b in body["birds"]] == [True, True]
    assert body["summary"]["weighed"] == 2 and body["content_type"] == "image/jpeg" and len(body["image"]) > 100
    video._clips.clear()


# ---------------------------------------------------------------------------
# The scale of a camera position, recognised from the video
# ---------------------------------------------------------------------------

def test_the_scale_of_a_camera_position_gives_absolute_weights_and_the_average_is_a_result():
    boxes = [(100, 100, 60, 60), (400, 100, 120, 60)]
    result = weight.size_weights(boxes, (1280, 720), grams_per_unit=0.002)
    small, big = (b["weight_g"] for b in result["birds"])
    assert small == pytest.approx(0.002 * 3600 ** 1.5, rel=0.001)
    assert big / small == pytest.approx(2 ** 1.5, rel=0.01)
    assert result["summary"]["mean_g"] == pytest.approx((small + big) / 2, abs=0.2)


def test_a_bird_has_the_same_size_whatever_resolution_the_clip_was_saved_at():
    assert weight.size_unit((10, 10, 60, 60), (1280, 720)) == pytest.approx(weight.size_unit((10, 10, 120, 120), (2560, 1440)), rel=1e-6)


def test_size_weights_needs_a_scale_or_an_average():
    with pytest.raises(ValueError):
        weight.size_weights([(100, 100, 60, 60)], FRAME)


def _scene(seed):
    import cv2

    rng = np.random.default_rng(seed)
    img = np.zeros((108, 192, 3), np.uint8)
    img[:, :96] = (60, 90, 180)
    img[:, 96:] = (170, 180, 60)
    img[20:60, 30:150] = (230, 230, 230)
    return np.clip(img + rng.integers(0, 6, img.shape), 0, 255).astype(np.uint8), cv2


def _calibration():
    import base64

    import cv2

    other = np.zeros((108, 192, 3), np.uint8)
    other[:54] = (200, 40, 40)
    other[54:, 100:] = (30, 200, 200)
    refs = {"P": weight.background_signature([_scene(1)[0]]), "Q": weight.background_signature([other])}
    return {
        "setups": {
            name: {
                "days": [1, 2],
                "grams_per_size_unit": k,
                "scale_spread_percent": 3.0,
                "_refs": [sig],
                "backgrounds": [base64.b64encode(cv2.imencode(".png", sig)[1].tobytes()).decode()],
            }
            for (name, sig), k in zip(refs.items(), (0.002, 0.005))
        }
    }


def test_a_scene_is_matched_to_its_own_camera_position_and_a_stranger_is_not():
    calibration = _calibration()
    name, best, runner = weight.identify_setup(weight.background_signature([_scene(2)[0]]), calibration)
    assert name == "P" and best > 0.9 and best - runner > weight.CLEAR_MARGIN
    flat = np.full((108, 192, 3), (60, 160, 60), np.uint8)
    assert weight.identify_setup(weight.background_signature([flat]), calibration)[0] is None


def test_the_birds_in_the_picture_do_not_change_which_position_it_is():
    # The background is the median of several frames, so birds that move between them drop out.
    frames = [_scene(3)[0].copy() for _ in range(5)]
    for i, f in enumerate(frames):
        f[10:30, 10 + 30 * i: 40 + 30 * i] = (255, 255, 255)
    name, best, runner = weight.identify_setup(weight.background_signature(frames), _calibration())
    assert name == "P"


def test_the_bird_weights_route_uses_the_scale_of_the_recognised_camera_position(tmp_path, monkeypatch):
    import app as service

    frame = _scene(2)[0]
    big = cv2_resize(frame, (480, 270))
    clip = _clip_of(tmp_path, monkeypatch, big)
    monkeypatch.setattr(service, "detector", _StubDetector())
    monkeypatch.setattr(weight, "load_calibration", lambda path=None: _calibration())
    response = _post_bird_weights(clip.id, "t=1")
    assert response.status_code == 200
    body = response.get_json()
    assert body["mean_g"] is None and body["calibration"]["mode"] == "camera_position" and body["calibration"]["position"] == "P"
    # absolute weights: the scale of position P times each bird's size, in a 480x270 picture rescaled to 1280x720
    first = body["birds"][0]["weight_g"]
    expected = 0.002 * weight.size_unit((10, 10, 20, 20), (480, 270))
    assert first == pytest.approx(expected, rel=0.01)
    video._clips.clear()


def test_the_bird_weights_route_asks_for_an_average_when_the_camera_position_is_unknown(tmp_path, monkeypatch):
    import app as service

    clip = _clip_of(tmp_path, monkeypatch, np.full((80, 120, 3), (60, 160, 60), np.uint8))  # a plain picture resembles no camera position
    monkeypatch.setattr(service, "detector", _StubDetector())
    monkeypatch.setattr(weight, "load_calibration", lambda path=None: _calibration())
    response = _post_bird_weights(clip.id, "t=1")
    assert response.status_code == 422 and response.get_json()["error"] == "camera_position_unknown"
    typed = _post_bird_weights(clip.id, "t=1&mean_g=1100")
    assert typed.status_code == 200 and typed.get_json()["calibration"]["mode"] == "typed_average"
    video._clips.clear()


def cv2_resize(img, size):
    import cv2

    return cv2.resize(img, size, interpolation=cv2.INTER_AREA)
