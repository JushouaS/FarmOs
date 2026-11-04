"""
Unit tests for where the camera's RTSP link comes from.

No camera, database or model is opened: these pin the two decisions the service
makes on every poll — which link wins, and what counts as a link at all — plus
the mask that keeps the camera's password out of logs and off the dashboard.

    pip install pytest      # dev only, not in the service image
    cd packages/vision && python -m pytest tests -q
"""

import sys
from pathlib import Path

# Modules in this service import each other by bare name ("import camera"),
# which is how the container runs them, so put the package root on the path.
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import camera  # noqa: E402
import camera_config  # noqa: E402


def test_a_named_source_keeps_its_id():
    assert camera_config.parse_sources("CAM-01=rtsp://cam/one") == {"CAM-01": "rtsp://cam/one"}


def test_unnamed_sources_are_numbered_in_order():
    assert camera_config.parse_sources("rtsp://cam/one,rtsp://cam/two") == {
        "camera_00": "rtsp://cam/one",
        "camera_01": "rtsp://cam/two",
    }


def test_a_padding_space_does_not_become_part_of_the_link():
    assert camera_config.parse_sources(" CAM-01 = rtsp://cam/one ") == {"CAM-01": "rtsp://cam/one"}


def test_a_named_source_with_no_address_is_not_a_camera():
    # Compose always passes "CAM-01=${DAHUA_RTSP_URL}", so an unset link arrives
    # exactly like this. Registering it would log a failed open every frame.
    assert camera_config.parse_sources("CAM-01=") == {}
    assert camera_config.parse_sources("") == {}


def test_the_password_is_masked_for_logs():
    assert camera_config.redact_url("rtsp://admin:s3cret@10.0.0.5:554/cam") == (
        "rtsp://admin:***@10.0.0.5:554/cam"
    )


def test_a_link_without_a_login_or_a_scheme_is_left_alone():
    assert camera_config.redact_url("rtsp://10.0.0.5:554/cam") == "rtsp://10.0.0.5:554/cam"
    assert camera_config.redact_url("") == ""


def test_the_test_button_refuses_anything_but_a_stream():
    # The probe opens what it is given, so a file path must never reach it.
    assert camera.probe_source("file:///etc/passwd")["ok"] is False
    assert camera.probe_source("")["ok"] is False
