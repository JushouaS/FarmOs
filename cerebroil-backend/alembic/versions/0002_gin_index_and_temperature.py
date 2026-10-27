"""Add GIN index on bbox_data JSONB and temperature_c column

Revision ID: 0002
Revises: 0001
Create Date: 2024-05-25 00:00:00.000000

Changes
───────
1. GIN index on tracking_events.bbox_data
2. temperature_c (Float, nullable) on tracking_events for heat_stress rule
3. Composite index on growth_logs (batch_id, recorded_at)
"""
from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0002"
down_revision: Union[str, None] = "0001"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ── 1. temperature_c column ───────────────────────────────────────────────
    op.add_column(
        "tracking_events",
        sa.Column(
            "temperature_c",
            sa.Float,
            nullable=True,
            comment="Ambient temperature C from Pi sensor at frame capture",
        ),
    )

    # ── 2. Composite index on growth_logs ────────────────────────────────────
    op.create_index(
        "ix_growth_logs_batch_recorded",
        "growth_logs",
        ["batch_id", "recorded_at"],
    )

    # ── 3. GIN index on bbox_data ─────────────────────────────────────────────
    # CREATE INDEX CONCURRENTLY cannot run inside a transaction.
    # autocommit_block() ends the current transaction so it can proceed.
    with op.get_context().autocommit_block():
        op.execute(
            sa.text(
                "CREATE INDEX CONCURRENTLY IF NOT EXISTS "
                "ix_tracking_events_bbox_data_gin "
                "ON tracking_events USING GIN (bbox_data)"
            )
        )


def downgrade() -> None:
    with op.get_context().autocommit_block():
        op.execute(
            sa.text(
                "DROP INDEX CONCURRENTLY IF EXISTS "
                "ix_tracking_events_bbox_data_gin"
            )
        )
    op.drop_index("ix_growth_logs_batch_recorded", table_name="growth_logs")
    op.drop_column("tracking_events", "temperature_c")
