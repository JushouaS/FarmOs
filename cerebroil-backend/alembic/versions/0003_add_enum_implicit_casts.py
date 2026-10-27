"""Add implicit casts for ENUM types

Revision ID: 0003
Revises: 0002
Create Date: 2026-10-19 00:00:00.000000

Ensures asyncpg VARCHAR parameters are automatically accepted by PostgreSQL
for batchstatus, alertseverity, and alerttype ENUM columns.
"""
from __future__ import annotations

from typing import Sequence, Union
import sqlalchemy as sa
from alembic import op

revision: str = "0003"
down_revision: Union[str, None] = "0002"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    conn = op.get_bind()
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


def downgrade() -> None:
    conn = op.get_bind()
    conn.execute(sa.text("DROP CAST IF EXISTS (varchar AS alerttype)"))
    conn.execute(sa.text("DROP CAST IF EXISTS (varchar AS alertseverity)"))
    conn.execute(sa.text("DROP CAST IF EXISTS (varchar AS batchstatus)"))
