#!/usr/bin/env python3
"""Reads a DHT22 (AM2302) temperature and humidity sensor on a Raspberry Pi.

It writes the newest reading to dht22.json next to this file. The camera service (app.py) hands that file to
the website's API at /sensors, and the API stores it. It runs as its own program (dht22.service, see
setup-dht22.sh) with the system Python, so a problem with the sensor can never take the camera down.

Every minute it also keeps a row in logs/temperature/, logs/humidity/ and logs/ammonia/ on the Pi's own disk
(MinuteLogs below; ammonia comes from ammonia.py, and says "no ammonia sensor connected" until one is wired).

    python3 dht22_reader.py --once      try to read the sensor a few times, print what happens, and stop
    python3 dht22_reader.py             keep reading, every DHT22_INTERVAL seconds

Wiring (Raspberry Pi 4, 3-pin module): + to pin 1 (3.3 V), OUT to pin 7 (GPIO 4), - to pin 6 (GND).

How it reads: the Pi holds the data line low for a few milliseconds, then lets go. The sensor answers with 40
bits, each a pulse that is short (about 27 microseconds) for a 0 and long (about 70) for a 1. Python is far too
slow to time that itself, so the kernel stamps every edge on the line (libgpiod, the Pi's own GPIO library) and
this program reads the stamps afterwards.

Settings (environment variables, all optional):
    DHT22_GPIO       GPIO number of the data line                  default 4  (physical pin 7)
    DHT22_GPIOCHIP   the GPIO device                               default /dev/gpiochip0  (Pi 4; a Pi 5 uses gpiochip4)
    DHT22_INTERVAL   seconds between readings                      default 10
    DHT22_FILE       where the reading is written                  default dht22.json beside this file
"""
from __future__ import annotations

import json
import os
import sys
import time
from datetime import timedelta
from pathlib import Path

import ammonia
import daily_log

GPIO_LINE = int(os.getenv("DHT22_GPIO", "4"))
GPIO_CHIP = os.getenv("DHT22_GPIOCHIP", "/dev/gpiochip0")
INTERVAL_SECONDS = max(4.0, float(os.getenv("DHT22_INTERVAL", "10")))
OUT_FILE = Path(os.getenv("DHT22_FILE", str(Path(__file__).with_name("dht22.json"))))

TRIES_PER_ROUND = 6          # a single read fails now and then; that is normal for this sensor
PAUSE_BETWEEN_TRIES = 2.2    # the DHT22 needs about 2 seconds of rest between reads
BIT_IS_ONE_NS = 50_000       # a high pulse longer than 50 microseconds is a 1 (a 0 is about 27, a 1 about 70)


class DhtError(Exception):
    """One read did not give a usable answer."""


def high_pulses(edges: list[tuple[bool, int]]) -> list[int]:
    """Widths, in nanoseconds, of the high pulses in a list of (is_rising, time_ns) edges."""
    widths: list[int] = []
    rose: int | None = None
    for rising, at in edges:
        if rising:
            rose = at
        elif rose is not None:
            widths.append(at - rose)
            rose = None
    return widths


def decode(widths: list[int]) -> tuple[float, float]:
    """(temperature in °C, humidity in %) from the high-pulse widths of one read.

    The last 40 pulses are the data bits. What comes before them (the moment the line was let go, and the
    sensor's own "here I come" pulse) is ignored, so it does not matter if the first of those was missed."""
    if len(widths) < 40:
        raise DhtError(f"only {len(widths)} of 40 bits arrived")
    bits = [1 if w > BIT_IS_ONE_NS else 0 for w in widths[-40:]]
    data = [int("".join(str(b) for b in bits[i : i + 8]), 2) for i in range(0, 40, 8)]
    if (data[0] + data[1] + data[2] + data[3]) & 0xFF != data[4]:
        raise DhtError("the check number did not match (a noisy read)")
    humidity = ((data[0] << 8) | data[1]) / 10
    temperature = (((data[2] & 0x7F) << 8) | data[3]) / 10
    if data[2] & 0x80:
        temperature = -temperature
    if not (0 <= humidity <= 100) or not (-40 <= temperature <= 80):
        raise DhtError(f"the numbers make no sense ({temperature} °C, {humidity} %)")
    return round(temperature, 1), round(humidity, 1)


def read_once(gpiod) -> tuple[float, float]:
    """Asks the sensor once. Raises DhtError when the answer is missing or damaged."""
    from gpiod.line import Bias, Direction, Edge, Value

    low = gpiod.LineSettings(direction=Direction.OUTPUT, output_value=Value.INACTIVE)
    try:
        request = gpiod.request_lines(GPIO_CHIP, consumer="cerebroil-dht22", config={GPIO_LINE: low}, event_buffer_size=256)
    except TypeError:  # an older libgpiod without the buffer size
        request = gpiod.request_lines(GPIO_CHIP, consumer="cerebroil-dht22", config={GPIO_LINE: low})
    with request:
        time.sleep(0.004)  # the sensor wakes when the line is held low for at least 1 millisecond
        try:
            listen = gpiod.LineSettings(direction=Direction.INPUT, bias=Bias.PULL_UP, edge_detection=Edge.BOTH)
            request.reconfigure_lines({GPIO_LINE: listen})
        except OSError:  # no internal pull-up on this board; the module has its own
            listen = gpiod.LineSettings(direction=Direction.INPUT, edge_detection=Edge.BOTH)
            request.reconfigure_lines({GPIO_LINE: listen})
        edges: list[tuple[bool, int]] = []
        give_up = time.monotonic() + 0.06
        while time.monotonic() < give_up:
            if request.wait_edge_events(timedelta(milliseconds=12)):
                for event in request.read_edge_events():
                    edges.append((event.event_type == event.Type.RISING_EDGE, event.timestamp_ns))
            elif edges:
                break  # quiet for 12 ms after the answer: that was all of it
    if not edges:
        raise DhtError("the sensor did not answer (check the wires and the 3.3 V)")
    return decode(high_pulses(edges))


class MinuteLogs:
    """The daily files this reader keeps on the Pi's own disk (daily_log.py), one folder per reading:
    logs/temperature/, logs/humidity/ and logs/ammonia/. A failed DHT22 read leaves temperature and humidity
    blank with the reason; ammonia has its own row and its own reason (ammonia.py)."""

    def __init__(self, directory: Path | None = None, **kw) -> None:
        self.temperature = daily_log.DailyCsv(
            "temperature", ["temperature_c", "reading_age_s", "error"], directory, folder=True, **kw)
        self.humidity = daily_log.DailyCsv(
            "humidity", ["humidity_pct", "reading_age_s", "error"], directory, folder=True, **kw)
        self.ammonia = daily_log.DailyCsv("ammonia", ["ammonia_ppm", "error"], directory, folder=True, **kw)

    def write(self, last_good: dict, error: str | None, now: float, ammonia_reading=None) -> None:
        age = now - last_good["at"] if last_good.get("at") else None
        fresh = age is not None and age <= 120  # an old value is not repeated as if it were new: the row is left blank
        age_s = round(age) if age is not None else None
        self.temperature.append({
            "temperature_c": last_good.get("temperature") if fresh else None,
            "reading_age_s": age_s,
            "error": error,
        })
        self.humidity.append({
            "humidity_pct": last_good.get("humidity") if fresh else None,
            "reading_age_s": age_s,
            "error": error,
        })
        ppm, why = ammonia_reading if ammonia_reading is not None else ammonia.read_ppm()
        self.ammonia.append({"ammonia_ppm": ppm, "error": why})


def write_state(state: dict) -> None:
    tmp = OUT_FILE.with_suffix(".tmp")
    tmp.write_text(json.dumps(state), encoding="utf-8")
    os.replace(tmp, OUT_FILE)  # the camera service never sees half a file


def main() -> int:
    once = "--once" in sys.argv
    try:
        import gpiod
        from gpiod.line import Direction  # noqa: F401  (v2 of the library has this; v1 does not)
    except ImportError:
        message = "python3-libgpiod (version 2) is not installed: sudo apt install python3-libgpiod"
        print(message)
        if once:
            return 1
        while True:
            write_state({"temperature": None, "humidity": None, "at": None, "checkedAt": time.time(), "error": message})
            time.sleep(60)

    last_good: dict = {"temperature": None, "humidity": None, "at": None}
    # A copy of every minute on this Pi's own disk, for when the laptop that stores the readings is off (daily_log.py).
    logs = MinuteLogs()
    log_every = float(os.getenv("LOG_SECONDS", "60"))
    logged_at = 0.0
    while True:
        started = time.monotonic()
        error: str | None = None
        for attempt in range(1, TRIES_PER_ROUND + 1):
            try:
                temperature, humidity = read_once(gpiod)
                last_good = {"temperature": temperature, "humidity": humidity, "at": time.time()}
                error = None
                if once:
                    print(f"try {attempt}: {temperature} °C, {humidity} %")
                break
            except DhtError as exc:
                error = str(exc)
            except OSError as exc:
                error = f"the GPIO pin could not be used: {exc}"
            if once:
                print(f"try {attempt}: {error}")
            time.sleep(PAUSE_BETWEEN_TRIES)
        write_state({**last_good, "checkedAt": time.time(), "error": error})
        if not once and time.time() - logged_at >= log_every:
            logged_at = time.time()
            logs.write(last_good, error, logged_at)
        if once:
            return 0 if error is None else 1
        time.sleep(max(1.0, INTERVAL_SECONDS - (time.monotonic() - started)))


if __name__ == "__main__":
    raise SystemExit(main())
