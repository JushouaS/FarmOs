"""
ammonia.py: the place where an ammonia reading will come from. No ammonia sensor is connected yet.

The sensor reader (dht22_reader.py) asks this every minute and writes the answer to
logs/ammonia/ammonia-YYYY-MM-DD.csv, so the file, its folder and its columns already exist. Until a sensor is
wired and supported here, every row has an empty ammonia_ppm and says why in its error column. A number is
never made up: an empty row is honest, an invented one is not.

To add a sensor later (for example an MQ-137 through an ADS1115 analog-to-digital board, since the Pi has no
analog input): write a read function for it below, add its name to READERS, and set AMMONIA_SENSOR=<name> in
cerebroil-stream/.env. The sensor needs its own calibration in clean air before its ppm can be trusted.

Settings (environment):
    AMMONIA_SENSOR   which sensor is connected; empty = none   default: empty
"""
from __future__ import annotations

import os
from typing import Callable

NOT_CONNECTED = "no ammonia sensor connected"

#: Supported sensors: name -> function returning the ammonia in ppm. None yet.
READERS: dict[str, Callable[[], float]] = {}


def read_ppm(sensor: str | None = None) -> tuple[float | None, str | None]:
    """(ammonia in ppm, None) when a reading worked, else (None, why it did not)."""
    name = (sensor if sensor is not None else os.getenv("AMMONIA_SENSOR", "")).strip().lower()
    if not name:
        return None, NOT_CONNECTED
    reader = READERS.get(name)
    if reader is None:
        return None, f"ammonia sensor '{name}' is not supported yet"
    try:
        ppm = float(reader())
    except Exception as exc:  # noqa: BLE001 - a failing sensor costs a row, never the reader
        return None, f"the ammonia sensor did not answer ({exc})"
    if not 0 <= ppm <= 1000:
        return None, f"the ammonia reading makes no sense ({ppm} ppm)"
    return round(ppm, 1), None
