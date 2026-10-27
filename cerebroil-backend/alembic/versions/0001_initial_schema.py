"""Initial schema — all six tables

Revision ID: 0001
Revises:
Create Date: 2024-05-24 00:00:00.000000

NOTE ON ENUM COLUMNS
─────────────────────
Columns that map to PostgreSQL ENUM types are declared as VARCHAR here so
that SQLAlchemy never fires an automatic CREATE TYPE event during migration.
The ENUM types are created via raw DO-block SQL before the tables, and the
columns are then altered to the ENUM type via a second statement.  This is
the only approach that is fully compatible with SQLAlchemy 2.0.36 + asyncpg
without patching SQLAlchemy internals.
"""
from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0001"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    conn = op.get_bind()

    # ── 1. Extensions & ENUM types ────────────────────────────────────────────
    conn.execute(sa.text("CREATE EXTENSION IF NOT EXISTS pgcrypto"))
    conn.execute(sa.text(
        "DO $$ BEGIN CREATE TYPE batchstatus   AS ENUM ('active','completed'); "
        "EXCEPTION WHEN duplicate_object THEN NULL; END $$"
    ))
    conn.execute(sa.text(
        "DO $$ BEGIN CREATE TYPE alertseverity AS ENUM ('info','warning','critical'); "
        "EXCEPTION WHEN duplicate_object THEN NULL; END $$"
    ))
    conn.execute(sa.text(
        "DO $$ BEGIN CREATE TYPE alerttype AS ENUM "
        "('low_activity','heat_stress','mortality_spike'); "
        "EXCEPTION WHEN duplicate_object THEN NULL; END $$"
    ))
    conn.execute(sa.text(
        "DO $$ BEGIN CREATE CAST (varchar AS batchstatus) WITH INOUT AS IMPLICIT; "
        "EXCEPTION WHEN duplicate_object THEN NULL; END $$"
    ))
    conn.execute(sa.text(
        "DO $$ BEGIN CREATE CAST (varchar AS alertseverity) WITH INOUT AS IMPLICIT; "
        "EXCEPTION WHEN duplicate_object THEN NULL; END $$"
    ))
    conn.execute(sa.text(
        "DO $$ BEGIN CREATE CAST (varchar AS alerttype) WITH INOUT AS IMPLICIT; "
        "EXCEPTION WHEN duplicate_object THEN NULL; END $$"
    ))

    # ── 2. farms ──────────────────────────────────────────────────────────────
    op.create_table(
        "farms",
        sa.Column("id",         postgresql.UUID(as_uuid=True), primary_key=True,
                  server_default=sa.text("gen_random_uuid()")),
        sa.Column("name",       sa.String(255), nullable=False),
        sa.Column("location",   sa.Text, nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True),
                  server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True),
                  server_default=sa.text("now()"), nullable=False),
    )
    op.create_index("ix_farms_name", "farms", ["name"])

    # ── 3. houses ─────────────────────────────────────────────────────────────
    op.create_table(
        "houses",
        sa.Column("id",         postgresql.UUID(as_uuid=True), primary_key=True,
                  server_default=sa.text("gen_random_uuid()")),
        sa.Column("farm_id",    postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("farms.id", ondelete="CASCADE"), nullable=False),
        sa.Column("house_name", sa.String(255), nullable=False),
        sa.Column("camera_ip",  sa.String(45),  nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True),
                  server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True),
                  server_default=sa.text("now()"), nullable=False),
    )
    op.create_index("ix_houses_farm_id", "houses", ["farm_id"])

    # ── 4. batches  (status as VARCHAR, then ALTER to ENUM) ───────────────────
    op.create_table(
        "batches",
        sa.Column("id",                  postgresql.UUID(as_uuid=True), primary_key=True,
                  server_default=sa.text("gen_random_uuid()")),
        sa.Column("house_id",            postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("houses.id", ondelete="CASCADE"), nullable=False),
        sa.Column("initial_bird_count",  sa.Integer, nullable=False),
        sa.Column("start_date",          sa.Date,    nullable=False),
        sa.Column("target_harvest_date", sa.Date,    nullable=True),
        sa.Column("status",              sa.String(20), nullable=False,
                  server_default="active"),
        sa.Column("created_at", sa.DateTime(timezone=True),
                  server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True),
                  server_default=sa.text("now()"), nullable=False),
    )
    op.create_index("ix_batches_house_id", "batches", ["house_id"])
    # Drop the varchar default, alter to ENUM, restore the default
    conn.execute(sa.text(
        "ALTER TABLE batches ALTER COLUMN status DROP DEFAULT"
    ))
    conn.execute(sa.text(
        "ALTER TABLE batches "
        "ALTER COLUMN status TYPE batchstatus USING status::batchstatus"
    ))
    conn.execute(sa.text(
        "ALTER TABLE batches ALTER COLUMN status SET DEFAULT 'active'::batchstatus"
    ))

    # ── 5. tracking_events ────────────────────────────────────────────────────
    op.create_table(
        "tracking_events",
        sa.Column("id",               sa.BigInteger, primary_key=True, autoincrement=True),
        sa.Column("batch_id",         postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("batches.id", ondelete="CASCADE"), nullable=False),
        sa.Column("timestamp",        sa.DateTime(timezone=True),
                  server_default=sa.text("now()"), nullable=False),
        sa.Column("track_id",         sa.Integer, nullable=False),
        sa.Column("bbox_data",        postgresql.JSONB, nullable=False),
        sa.Column("depth_z",          sa.Float,   nullable=True),
        sa.Column("spatial_centroid", postgresql.JSONB, nullable=True),
    )
    op.create_index("ix_tracking_events_batch_timestamp",
                    "tracking_events", ["batch_id", "timestamp"])
    op.create_index("ix_tracking_events_timestamp",
                    "tracking_events", ["timestamp"])

    # ── 6. growth_logs ────────────────────────────────────────────────────────
    op.create_table(
        "growth_logs",
        sa.Column("id",                     postgresql.UUID(as_uuid=True), primary_key=True,
                  server_default=sa.text("gen_random_uuid()")),
        sa.Column("batch_id",               postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("batches.id", ondelete="CASCADE"), nullable=False),
        sa.Column("recorded_at",            sa.DateTime(timezone=True),
                  server_default=sa.text("now()"), nullable=False),
        sa.Column("estimated_avg_weight_g", sa.Float,   nullable=True),
        sa.Column("flock_density_pct",      sa.Float,   nullable=True),
        sa.Column("daily_mortality_count",  sa.Integer, nullable=False, server_default="0"),
    )
    op.create_index("ix_growth_logs_batch_id",    "growth_logs", ["batch_id"])
    op.create_index("ix_growth_logs_recorded_at", "growth_logs", ["recorded_at"])

    # ── 7. alerts  (severity + alert_type as VARCHAR, then ALTER to ENUM) ─────
    op.create_table(
        "alerts",
        sa.Column("id",          postgresql.UUID(as_uuid=True), primary_key=True,
                  server_default=sa.text("gen_random_uuid()")),
        sa.Column("batch_id",    postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("batches.id", ondelete="CASCADE"), nullable=False),
        sa.Column("severity",    sa.String(20), nullable=False),
        sa.Column("alert_type",  sa.String(30), nullable=False),
        sa.Column("message",     sa.Text,       nullable=False),
        sa.Column("is_resolved", sa.Boolean,    nullable=False, server_default="false"),
        sa.Column("created_at",  sa.DateTime(timezone=True),
                  server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at",  sa.DateTime(timezone=True),
                  server_default=sa.text("now()"), nullable=False),
    )
    op.create_index("ix_alerts_batch_id", "alerts", ["batch_id"])
    # Alter to real ENUM types
    conn.execute(sa.text(
        "ALTER TABLE alerts "
        "ALTER COLUMN severity   TYPE alertseverity USING severity::alertseverity, "
        "ALTER COLUMN alert_type TYPE alerttype     USING alert_type::alerttype"
    ))


def downgrade() -> None:
    op.drop_table("alerts")
    op.drop_table("growth_logs")
    op.drop_table("tracking_events")
    op.drop_table("batches")
    op.drop_table("houses")
    op.drop_table("farms")
    op.execute(sa.text("DROP TYPE IF EXISTS alerttype"))
    op.execute(sa.text("DROP TYPE IF EXISTS alertseverity"))
    op.execute(sa.text("DROP TYPE IF EXISTS batchstatus"))
