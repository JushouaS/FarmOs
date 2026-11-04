"""
Where the camera's RTSP link comes from, and how a change reaches the cameras.

Until now the link was an environment variable read once at import, which made
the only way to change it a container restart. Settings now stores it in
`system_settings` (key "camera") and this module reads that row, so a save on
the dashboard is all an operator does.

Order of precedence:

  1. the link saved in Settings, when it holds one;
  2. `RTSP_SOURCES` from the environment ("CAM-01=rtsp://…"), which is what a
     deployment that has never opened Settings runs on;
  3. no camera at all.

Clearing the setting deletes the row, so the service drops back to the
environment link instead of going blind.

The read is deliberately not cached: the only caller is a poll loop that runs
every few seconds, and a stale cache would turn "saved" into "nothing happened
for another twenty seconds".
"""

import json
import logging
import os

try:
    import psycopg2
    from psycopg2 import errors as pg_errors
except ImportError:  # pragma: no cover - the service image always has it
    # Imported lazily for the same reason detector imports onnxruntime that way:
    # a missing driver must not stop the service from starting. Without it there
    # is simply no stored link, and the environment one is used.
    psycopg2 = None
    pg_errors = None

logger = logging.getLogger(__name__)

#: Which camera the dashboard watches. The same id cerebroil-stream answers to.
CAMERA_ID = os.getenv("CAMERA_ID", "CAM-01")

_raw = os.getenv("DATABASE_URL", "")
# psycopg2 wants the plain libpq DSN, not the SQLAlchemy one some tools export.
DATABASE_URL = _raw.replace("postgresql+psycopg2://", "postgresql://").replace(
    "postgres://", "postgresql://"
)

# Only complain once per kind of failure, otherwise a down database fills the
# log with the same traceback every few seconds.
_warned: set[str] = set()


def _warn_once(key: str, message: str, *args) -> None:
    if key in _warned:
        return
    _warned.add(key)
    logger.warning(message, *args)


def redact_url(url: str) -> str:
    """The link with its password replaced by ***, for logs and for /cameras."""
    if not url:
        return url
    head, sep, tail = url.partition("://")
    if not sep:
        return url
    userinfo, at, rest = tail.partition("@")
    if not at:
        return url
    user, colon, _password = userinfo.partition(":")
    return f"{head}{sep}{user}{colon}***@{rest}"


def parse_sources(raw: str) -> dict[str, str]:
    """
    "CAM-01=rtsp://…,rtsp://…" -> {"CAM-01": "rtsp://…", "camera_01": "rtsp://…"}.

    Compose always passes "CAM-01=${DAHUA_RTSP_URL}", so an empty variable
    arrives as a camera with no address. That is not a camera: registering it
    would leave one that can never open, and every frame grab would log the
    same warning fifteen times a second.
    """
    sources: dict[str, str] = {}
    for idx, part in enumerate(raw.split(",")):
        part = part.strip()
        if not part:
            continue
        if "=" in part:
            cid, url = part.split("=", 1)
            cid, url = cid.strip(), url.strip()
        else:
            cid, url = f"camera_{idx:02d}", part
        if not url:
            logger.warning("Ignoring %s: no RTSP URL configured", cid)
            continue
        sources[cid] = url
    return sources


def env_sources() -> dict[str, str]:
    """The cameras named by RTSP_SOURCES, as the service starts on."""
    return parse_sources(os.getenv("RTSP_SOURCES", ""))


def stored_url() -> str | None:
    """The link Settings saved, or None when it holds none (or cannot be read)."""
    if psycopg2 is None:
        _warn_once("no-driver", "psycopg2 is not installed — camera link comes from RTSP_SOURCES")
        return None
    if not DATABASE_URL:
        _warn_once("no-url", "DATABASE_URL is not set — camera link comes from RTSP_SOURCES")
        return None

    try:
        with psycopg2.connect(DATABASE_URL, connect_timeout=3) as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT value FROM system_settings WHERE key = 'camera'")
                row = cur.fetchone()
    except pg_errors.UndefinedTable:
        _warn_once("no-table", "system_settings does not exist yet — run the migrations")
        return None
    except Exception as exc:  # noqa: BLE001 - a missing setting must not stop the camera
        _warn_once(f"error:{type(exc).__name__}", "Could not read the camera setting: %s", exc)
        return None

    _warned.clear()
    if not row:
        return None

    # psycopg2 hands jsonb back as a str unless a json adapter is registered.
    value = json.loads(row[0]) if isinstance(row[0], str) else row[0]
    url = value.get("rtspUrl") if isinstance(value, dict) else None
    return url.strip() if isinstance(url, str) and url.strip() else None


def read_sources() -> dict[str, str]:
    """The camera map the service should be using right now."""
    url = stored_url()
    if url:
        return {CAMERA_ID: url}
    return env_sources()
