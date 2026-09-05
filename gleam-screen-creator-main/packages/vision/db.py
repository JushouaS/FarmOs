"""
PostgreSQL writer for vision pipeline results.

Writes detections, behaviour snapshots, and cluster warnings into
the tables created by the Fastify API migrations.  Uses psycopg2
directly so the Flask service is independent of the Node.js stack.
"""

import json
import logging
from contextlib import contextmanager
from datetime import datetime, timezone
from typing import Any

import psycopg2
from psycopg2 import pool

from detector import BehaviorSnapshot, ClusterWarning, Detection

logger = logging.getLogger(__name__)

# Module-level connection pool (initialised in ``init_pool``).
_pool: pool.ThreadedConnectionPool | None = None


def init_pool(database_url: str, min_conn: int = 1, max_conn: int = 5) -> None:
    """Create a threaded connection pool.  Call once at startup."""
    global _pool
    if _pool is not None:
        _pool.closeall()
    _pool = pool.ThreadedConnectionPool(min_conn, max_conn, dsn=database_url)
    logger.info("Database pool initialised (min=%d, max=%d)", min_conn, max_conn)


def close_pool() -> None:
    """Close all connections.  Call on shutdown."""
    global _pool
    if _pool is not None:
        _pool.closeall()
        _pool = None
        logger.info("Database pool closed")


@contextmanager
def get_conn():
    """Context manager that borrows and returns a connection."""
    if _pool is None:
        raise RuntimeError("Database pool not initialised — call init_pool() first")
    conn = _pool.getconn()
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        _pool.putconn(conn)


# ---------------------------------------------------------------------------
# Write helpers
# ---------------------------------------------------------------------------

def write_detections(camera_id: str, detections: list[Detection]) -> int:
    """
    Insert a batch of detections for the given camera.

    Returns the number of rows inserted.
    """
    if not detections:
        return 0

    now = datetime.now(timezone.utc).isoformat()
    rows = 0

    with get_conn() as conn:
        with conn.cursor() as cur:
            for d in detections:
                cur.execute(
                    """
                    INSERT INTO detections
                        (camera_id, box_x, box_y, box_w, box_h,
                         behavior, estimated_weight_g, weight_confidence,
                         flag, frame_at)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                    """,
                    (
                        camera_id,
                        d.box_x,
                        d.box_y,
                        d.box_w,
                        d.box_h,
                        d.behavior,
                        d.estimated_weight_g,
                        d.weight_confidence,
                        d.flag,
                        now,
                    ),
                )
                rows += 1

    logger.info("Wrote %d detections for camera %s", rows, camera_id)
    return rows


def write_behaviour_snapshot(camera_id: str, snapshot: BehaviorSnapshot) -> bool:
    """Insert a behaviour snapshot for the given camera."""
    now = datetime.now(timezone.utc).isoformat()

    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO behavior_snapshots
                    (camera_id, movement_index, movement_label, movement_status,
                     huddling_risk, huddling_label, huddling_status,
                     aggression_events, at)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
                """,
                (
                    camera_id,
                    snapshot.movement_index,
                    snapshot.movement_label,
                    snapshot.movement_status,
                    snapshot.huddling_risk,
                    snapshot.huddling_label,
                    snapshot.huddling_status,
                    snapshot.aggression_events,
                    now,
                ),
            )

    logger.info("Wrote behaviour snapshot for camera %s", camera_id)
    return True


def write_cluster_warning(camera_id: str, warning: ClusterWarning) -> bool:
    """Insert a cluster warning for the given camera."""
    now = datetime.now(timezone.utc).isoformat()

    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO cluster_warnings
                    (camera_id, label, risk, box, raised_at)
                VALUES (%s, %s, %s, %s::jsonb, %s)
                """,
                (
                    camera_id,
                    warning.label,
                    warning.risk,
                    warning.box,
                    now,
                ),
            )

    logger.info("Wrote cluster warning for camera %s", camera_id)
    return True


def write_volumetric_sample(
    camera_id: str,
    weight_median_g: float,
    weight_std_g: float,
    sample_size: int,
    confidence: float,
) -> bool:
    """Insert a volumetric (weight) sample for the given camera."""
    now = datetime.now(timezone.utc).isoformat()

    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO volumetric_samples
                    (camera_id, median_g, standard_deviation_g,
                     sample_size, confidence, recorded_at)
                VALUES (%s, %s, %s, %s, %s, %s)
                """,
                (
                    camera_id,
                    weight_median_g,
                    weight_std_g,
                    sample_size,
                    confidence,
                    now,
                ),
            )

    logger.info("Wrote volumetric sample for camera %s", camera_id)
    return True


def prune_old_detections(camera_id: str, keep: int = 500) -> int:
    """
    Delete older detections beyond the ``keep`` most recent rows
    for a given camera, to prevent unbounded table growth.
    """
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                DELETE FROM detections
                WHERE camera_id = %s
                  AND id NOT IN (
                      SELECT id FROM detections
                      WHERE camera_id = %s
                      ORDER BY frame_at DESC
                      LIMIT %s
                  )
                """,
                (camera_id, camera_id, keep),
            )
            deleted = cur.rowcount

    if deleted:
        logger.info("Pruned %d old detections for camera %s", deleted, camera_id)
    return deleted
