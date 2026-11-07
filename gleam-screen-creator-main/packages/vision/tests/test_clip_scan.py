"""
Tracked clip scan tests. No model and no database: the "detector" reads the
birds straight off the synthetic frames, so what is tested is the scan's
bookkeeping (gaps, resets, warm-up, numbering, exports), not the detector.

    cd packages/vision && python -m pytest tests/test_clip_scan.py -q
"""
import sys
import threading
import time
from pathlib import Path
from types import SimpleNamespace

import cv2
import numpy as np
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import clip_scan as cs  # noqa: E402
import mot_metrics  # noqa: E402

W, H = 320, 240


def bird_frame(t: float, birds=((60, 60), (200, 150))) -> np.ndarray:
    """Grey floor, a moving texture so frames are never identical, and bright birds."""
    img = np.full((H, W, 3), 80, np.uint8)
    cv2.putText(img, f"{t:.1f}", (int(t * 7) % (W - 60), 120), cv2.FONT_HERSHEY_SIMPLEX, 1.0, (140, 140, 140), 2)
    for k, (x, y) in enumerate(birds):
        cx, cy = x + int(t), y
        cv2.rectangle(img, (cx - 15, cy - 15), (cx + 15, cy + 15), (250, 250, 250), -1)
    return img


def white_box_detector(frame):
    """Finds the white squares; score 0.9."""
    mask = cv2.inRange(frame, (240, 240, 240), (255, 255, 255))
    n, _, stats, cents = cv2.connectedComponentsWithStats(mask)
    return [(float(cents[i][0]), float(cents[i][1]), float(stats[i][2]), float(stats[i][3]), 0.9)
            for i in range(1, n) if stats[i][4] > 100]


def frames(times, freeze_after=None, freeze_len=0, empty_at=()):
    """(t, n, image) samples; optionally a frozen stretch (the same image repeated)."""
    out, frozen = [], None
    for n, t in enumerate(times, start=1):
        if freeze_after is not None and freeze_after < t <= freeze_after + freeze_len:
            frozen = frozen if frozen is not None else bird_frame(freeze_after)
            out.append((t, n, frozen.copy()))
        elif t in empty_at:
            img = bird_frame(t, birds=())
            out.append((t, n, img))
        else:
            out.append((t, n, bird_frame(t)))
    return out


SETTINGS = cs.ScanSettings(interval=2.0)


def run(samples, settings=SETTINGS):
    return list(cs.scan(samples, white_box_detector, settings))


def test_clean_clip_is_all_valid_and_birds_keep_their_numbers():
    out = run(frames([2.0 * i for i in range(20)]))
    assert {s.status for s in out} == {"VALID"}
    assert all(sorted(b.id for b in s.birds) == [1, 2] for s in out)
    assert out[-1].body_len == pytest.approx(31, abs=2)


def test_freeze_becomes_gap_then_reset_and_warmup():
    times = [2.0 * i for i in range(20)]
    out = run(frames(times, freeze_after=10.0, freeze_len=8.0))
    statuses = [s.status for s in out]
    # 10.0 is the genuine first image of the freeze; 12..18 repeat it.
    assert statuses[:6] == ["VALID"] * 6
    assert statuses[6:10] == ["GAP"] * 4
    assert {s.reason for s in out[6:10]} == {"frozen_frame"}
    assert statuses[10:13] == ["RECOVERING"] * 3
    assert statuses[13:] == ["VALID"] * (len(times) - 13)
    # The tracker was reset: a new session, and numbers that do not reuse 1 and 2.
    assert out[10].session == 1
    assert sorted(b.id for b in out[10].birds) == [3, 4]
    assert all(sorted(b.id for b in s.birds) == [3, 4] for s in out[10:])


def test_time_jump_is_a_gap():
    times = [0.0, 2.0, 4.0, 30.0, 32.0, 34.0, 36.0, 38.0]
    out = run(frames(times))
    assert [s.status for s in out][:4] == ["VALID", "VALID", "VALID", "GAP"]
    assert out[3].reason == "timestamp_jump" and out[3].frame_no is None
    assert [s.status for s in out[4:]] == ["RECOVERING", "RECOVERING", "RECOVERING", "VALID", "VALID"]


def test_frame_without_birds_is_a_gap():
    out = run(frames([2.0 * i for i in range(8)], empty_at=(6.0,)))
    assert out[3].status == "GAP" and out[3].reason == "too_few_tracked_birds"
    assert out[4].status == "RECOVERING"


def test_operator_exclusion():
    settings = SETTINGS.with_overrides(exclude=["00:00:04-00:00:08"])
    out = run(frames([2.0 * i for i in range(10)]), settings)
    assert [s.reason for s in out[2:4]] == ["excluded_interval"] * 2


def test_settings_are_checked():
    with pytest.raises(ValueError):
        SETTINGS.with_overrides(interval=0)
    with pytest.raises(ValueError):
        SETTINGS.with_overrides(exclude=["00:02:00-00:01:00"])
    assert SETTINGS.with_overrides(interval=1.0).interval == 1.0


def test_cancel_stops_the_scan():
    stop = threading.Event()
    gen = cs.scan(frames([2.0 * i for i in range(30)]), white_box_detector, SETTINGS, cancel=stop)
    first = [next(gen) for _ in range(4)]
    stop.set()
    assert len(first) == 4 and list(gen) == []


def _job(samples):
    clip = SimpleNamespace(id="c1", name="day 1.mp4", path="unused", duration=samples[-1][0])
    job = cs.ScanJob(clip, SETTINGS)
    job.run(white_box_detector, frames=samples)
    return job


def test_job_summary_and_exports():
    times = [2.0 * i for i in range(20)]
    job = _job(frames(times, freeze_after=10.0, freeze_len=8.0))
    s = job.summary()
    assert s["status"] == "done"
    assert s["counts"] == {"VALID": 13, "GAP": 4, "RECOVERING": 3}
    assert s["gap_reasons"] == {"frozen_frame": 4, "tracker_warmup": 3}
    assert s["tracking"]["distinct_ids"] == 4 and s["sessions"] == 2
    assert s["progress"]["frames_done"] == 20
    assert s["settings"]["klydel_commit"] == "9c6f755"

    rows = job.samples_csv().strip().splitlines()
    assert rows[0].startswith("t_s,status,reason,n_birds,n_huddles,n_inactive,body_len_px,recovered")
    gap_row = rows[7].split(",")
    assert gap_row[1] == "GAP" and gap_row[3] == ""        # unknown, not zero

    mot = job.mot_text()
    parsed = {}
    for line in mot.strip().splitlines():
        f, tid = (int(v) for v in line.split(",")[:2])
        parsed.setdefault(f, set()).add(tid)
    assert parsed[1] == {1, 2} and parsed[20] == {3, 4}
    assert 7 not in parsed                                 # GAP frames have no rows


def test_mot_export_scores_perfectly_against_itself(tmp_path):
    job = _job(frames([2.0 * i for i in range(15)]))
    path = tmp_path / "pred.txt"
    path.write_text(job.mot_text())
    data = mot_metrics.read_mot(str(path))
    s = mot_metrics.evaluate(data, data)
    assert (s.mota, s.idf1) == (1.0, 1.0)


def test_sample_near_skips_gaps():
    job = _job(frames([2.0 * i for i in range(20)], freeze_after=10.0, freeze_len=8.0))
    assert job.sample_near(14.0).t in (10.0, 20.0)
    assert job.sample_near(14.0).status != "GAP"


def test_annotate_draws_numbers():
    sample = cs.ScanSample(4.0, 3, "VALID", birds=[cs.TrackedBird(7, 60, 60, 30, 30, 0.9, False)])
    img = bird_frame(4.0)
    out = cs.annotate(img, sample)
    assert out.shape == img.shape and not np.array_equal(out, img)


def test_registry_one_scan_at_a_time():
    reg = cs.ScanRegistry()
    gate = threading.Event()

    def slow_detect(frame):
        gate.wait(5)
        return white_box_detector(frame)

    class Clip:
        id, name, duration = "a", "a.mp4", 20.0
        path = "missing-file.mp4"

    job = reg.start(Clip, slow_detect, SETTINGS)
    with pytest.raises(cs.ScanBusy):
        reg.start(SimpleNamespace(id="b", name="b.mp4", duration=10.0, path="x"), slow_detect, SETTINGS)
    gate.set()
    job.thread.join(5)
    assert job.status == "failed"            # the file does not exist; reported, not raised
    assert "could not be opened" in job.error
    reg.forget("a")
    assert reg.get("a") is None


def test_real_video_file(tmp_path):
    """The whole path through OpenCV: write a clip, scan it from disk."""
    path = tmp_path / "clip.avi"
    writer = cv2.VideoWriter(str(path), cv2.VideoWriter_fourcc(*"MJPG"), 5, (W, H))
    for i in range(5 * 12):                     # 12 s at 5 fps
        writer.write(bird_frame(i / 5))
    writer.release()
    out = list(cs.scan(cs.sample_frames(str(path), 2.0), white_box_detector, SETTINGS))
    assert [round(s.t, 1) for s in out] == [0.0, 2.0, 4.0, 6.0, 8.0, 10.0]
    assert all(s.status == "VALID" and len(s.birds) == 2 for s in out)
