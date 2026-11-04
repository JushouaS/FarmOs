"""
The Dahua camera's RTSP link, and where to read it from.

The link carries the camera's login, so it is not something to keep in three
places. Settings stores it in `system_settings` (key "camera") and this module
is how this service finds it; `DAHUA_RTSP_URL` in the environment remains the
fallback for an installation that has never opened Settings.

Clearing the setting deletes the row, so the service goes back to the
environment link instead of going blind.

The read is not cached: the caller is a poll loop that runs every few seconds,
and a cache would only delay the reconnect a save is asking for.
"""

import json
import logging
import os

try:
    import psycopg2
    from psycopg2 import errors as pg_errors
except ImportError:  # pragma: no cover - the service image always has it
    # A missing driver must not stop the stream: without it there is simply no
    # stored link, and the environment one is used.
    psycopg2 = None
    pg_errors = None

logger = logging.getLogger(__name__)

_raw = os.getenv("DATABASE_URL", "")
# psycopg2 wants the plain libpq DSN, not the SQLAlchemy one some tools export.
DATABASE_URL = _raw.replace("postgresql+psycopg2://", "postgresql://").replace(
    "postgres://", "postgresql://"
)

_warned: set[str] = set()


def _warn_once(key: str, message: str, *args) -> None:
    if key in _warned:
        return
    _warned.add(key)
    logger.warning(message, *args)


def redact_url(url: str) -> str:
    """The link with its password replaced by ***, for logs and for /status."""
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


def _stored_url() -> str | None:
    """The link Settings saved, or None when it holds none (or cannot be read)."""
    if psycopg2 is None:
        _warn_once("no-driver", "psycopg2 is not installed — camera link comes from .env")
        return None
    if not DATABASE_URL:
        _warn_once("no-url", "DATABASE_URL is not set — camera link comes from .env")
        return None

    try:
        with psycopg2.connect(DATABASE_URL, connect_timeout=3) as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT value FROM system_settings WHERE key = 'camera'")
                row = cur.fetchone()
    except pg_errors.UndefinedTable:
        _warn_once("no-table", "system_settings does not exist yet — run the migrations")
        return None
    except Exception as exc:  # noqa: BLE001 - a missing setting must not stop the stream
        _warn_once(f"error:{type(exc).__name__}", "Could not read the camera setting: %s", exc)
        return None

    _warned.clear()
    if not row:
        return None

    # psycopg2 hands jsonb back as a str unless a json adapter is registered.
    value = json.loads(row[0]) if isinstance(row[0], str) else row[0]
    url = value.get("rtspUrl") if isinstance(value, dict) else None
    return url.strip() if isinstance(url, str) and url.strip() else None


def read_url() -> str | None:
    """The link the stream should be opening right now, or None for no camera."""
    stored = _stored_url()
    if stored:
        return stored
    from_env = os.getenv("DAHUA_RTSP_URL", os.getenv("RTSP_URL", "")) or ""
    return from_env.strip() or None
