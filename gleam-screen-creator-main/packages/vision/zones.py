"""
Read-only access to the feeder/drinker zones an operator marked by hand.

The zones themselves are drawn and saved in the dashboard; the API owns that
table and is the only writer. This module only reads it, because the analysis
runs here and cannot ask for the zones per request — it needs to know them
whether or not anyone is watching the screen.

Results are cached for a short while (ZONES_CACHE_SECONDS, default 30). Redraw
a zone in the dashboard and the next analysis after that window picks it up.
Reading on every analysis would be one small query per minute per camera, but
a stale cache would be worse than a query: an operator would redraw a polygon
and see no effect, then redraw it again.

Failure is not fatal. No database, no table, no rows — the analysis still runs,
just without zone exclusion, because a missing polygon must never stop the
camera from being monitored.
"""

import json
import logging
import os
import threading
import time

import psycopg2

logger = logging.getLogger(__name__)

CACHE_SECONDS = float(os.getenv("ZONES_CACHE_SECONDS", "30"))

# ZONES_DATABASE_URL lets a service read the zones without also taking the camera link from the database
# (scripts/run-vision.ps1 uses it on the laptop, where the camera is only reachable through the Pi).
_raw = os.getenv("ZONES_DATABASE_URL") or os.getenv("DATABASE_URL", "")
DATABASE_URL = _raw.replace("postgresql+psycopg2://", "postgresql://").replace(
    "postgres://", "postgresql://"
)

Polygon = list[list[float]]

_cache: dict[str, tuple[float, list[Polygon]]] = {}
_lock = threading.Lock()
# Only complain once per failure kind, otherwise a down database fills the log
# with one traceback every 30 seconds per camera.
_warned: set[str] = set()


def _warn_once(key: str, message: str, *args) -> None:
    if key in _warned:
        return
    _warned.add(key)
    logger.warning(message, *args)


def _is_polygon(value) -> bool:
    """A usable polygon is a list of at least three [x, y] pairs in 0..1."""
    if not isinstance(value, list) or len(value) < 3:
        return False
    for point in value:
        if not isinstance(point, list) or len(point) != 2:
            return False
        if not all(isinstance(v, (int, float)) for v in point):
            return False
    return True


def _fetch(camera_id: str) -> list[Polygon]:
    if not DATABASE_URL:
        _warn_once("no-url", "DATABASE_URL is not set — running without feeder zones")
        return []

    try:
        with psycopg2.connect(DATABASE_URL, connect_timeout=3) as conn:
            with conn.cursor() as cur:
                # Newest first, then flipped, so the drawing order on screen is
                # stable between refreshes.
                cur.execute(
                    """
                    SELECT polygon
                    FROM camera_zones
                    WHERE camera_id = %s AND enabled
                    ORDER BY created_at
                    """,
                    (camera_id,),
                )
                rows = cur.fetchall()
    except psycopg2.errors.UndefinedTable:
        _warn_once("no-table", "camera_zones does not exist yet — run the migrations")
        return []
    except Exception as exc:  # noqa: BLE001 - monitoring must not stop for this
        _warn_once(f"error:{type(exc).__name__}", "Could not read camera zones: %s", exc)
        return []

    _warned.clear()

    polygons: list[Polygon] = []
    for (raw,) in rows:
        # psycopg2 hands jsonb back as a str unless a json adapter is registered.
        value = json.loads(raw) if isinstance(raw, str) else raw
        if _is_polygon(value):
            polygons.append([[float(p[0]), float(p[1])] for p in value])
        else:
            logger.warning("Ignoring malformed zone polygon for %s: %r", camera_id, raw)
    return polygons


def get_zones(camera_id: str) -> list[Polygon]:
    """Enabled feeder/drinker polygons for a camera, cached for a short while."""
    now = time.monotonic()
    with _lock:
        hit = _cache.get(camera_id)
        if hit and now - hit[0] < CACHE_SECONDS:
            return hit[1]

    polygons = _fetch(camera_id)

    with _lock:
        _cache[camera_id] = (now, polygons)
    return polygons


def invalidate(camera_id: str | None = None) -> None:
    """Drop the cache. Called by the API's save handler so a redraw applies at once."""
    with _lock:
        if camera_id is None:
            _cache.clear()
        else:
            _cache.pop(camera_id, None)
