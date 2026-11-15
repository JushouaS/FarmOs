"""The DHT22 reader stops itself (so systemd starts it fresh) after DHT22_RESTART_AFTER seconds without a good reading."""
from __future__ import annotations

import sys
import types

import pytest

import dht22_reader


@pytest.fixture
def fake_gpiod(monkeypatch, tmp_path):
    gpiod = types.ModuleType("gpiod")
    line = types.ModuleType("gpiod.line")
    line.Direction = object
    gpiod.line = line
    monkeypatch.setitem(sys.modules, "gpiod", gpiod)
    monkeypatch.setitem(sys.modules, "gpiod.line", line)
    monkeypatch.setattr(dht22_reader, "OUT_FILE", tmp_path / "dht22.json")
    monkeypatch.setattr(dht22_reader, "MinuteLogs", lambda: types.SimpleNamespace(write=lambda *a, **k: None))
    monkeypatch.setattr(dht22_reader.time, "sleep", lambda s: None)
    monkeypatch.setattr(sys, "argv", ["dht22_reader.py"])
    return tmp_path


def test_a_stuck_sensor_makes_the_reader_exit_for_a_restart(fake_gpiod, monkeypatch):
    def broken(_):
        raise dht22_reader.DhtError("the sensor did not answer")

    monkeypatch.setattr(dht22_reader, "read_once", broken)
    monkeypatch.setattr(dht22_reader, "RESTART_AFTER_SECONDS", 0.0001)
    assert dht22_reader.main() == dht22_reader.EXIT_RESTART
    assert "restarting the sensor reader" in (fake_gpiod / "dht22.json").read_text()


def test_a_working_sensor_keeps_running(fake_gpiod, monkeypatch):
    rounds = {"n": 0}

    def good(_):
        rounds["n"] += 1
        if rounds["n"] > 5:
            raise KeyboardInterrupt  # stop the endless loop for the test
        return 30.1, 65.0

    monkeypatch.setattr(dht22_reader, "read_once", good)
    monkeypatch.setattr(dht22_reader, "RESTART_AFTER_SECONDS", 0.0001)
    with pytest.raises(KeyboardInterrupt):
        dht22_reader.main()
    assert rounds["n"] == 6


def test_zero_means_never_restart(fake_gpiod, monkeypatch):
    calls = {"n": 0}

    def broken(_):
        calls["n"] += 1
        if calls["n"] > 3 * dht22_reader.TRIES_PER_ROUND:
            raise KeyboardInterrupt
        raise dht22_reader.DhtError("noisy")

    monkeypatch.setattr(dht22_reader, "read_once", broken)
    monkeypatch.setattr(dht22_reader, "RESTART_AFTER_SECONDS", 0.0)
    with pytest.raises(KeyboardInterrupt):
        dht22_reader.main()
