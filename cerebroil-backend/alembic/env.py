"""
alembic/env.py
───────────────
Async Alembic environment.

Key decisions
─────────────
• Uses `run_async_migrations()` with `AsyncEngine` + `asyncpg` driver —
  required because our SQLAlchemy models use AsyncSession throughout the app.
• `target_metadata` is set from the app's `Base` so Alembic autogenerate
  can detect model changes and produce migration scripts automatically.
• The DATABASE_URL is read from the same `Settings` object the app uses,
  so no duplicate config is needed.
"""
from __future__ import annotations

import asyncio
from logging.config import fileConfig

from alembic import context
from sqlalchemy import pool
from sqlalchemy.engine import Connection
from sqlalchemy.ext.asyncio import async_engine_from_config

# ── App imports ───────────────────────────────────────────────────────────────
# Import all models so Alembic can see the full metadata graph.
from app.config import get_settings
from app.database import Base
import app.models  # noqa: F401 – registers all ORM models onto Base.metadata

settings = get_settings()

# ── Alembic config object ─────────────────────────────────────────────────────
config = context.config

# Set the DB URL from our Pydantic settings (overrides alembic.ini value)
config.set_main_option("sqlalchemy.url", settings.DATABASE_URL)

# Configure Python logging from alembic.ini [loggers] section
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

# Metadata for --autogenerate
target_metadata = Base.metadata


# ── Offline mode (generates SQL without a live DB connection) ─────────────────
def run_migrations_offline() -> None:
    url = config.get_main_option("sqlalchemy.url")
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        # Render CREATE TYPE / DROP TYPE for PostgreSQL enums
        include_schemas=True,
    )
    with context.begin_transaction():
        context.run_migrations()


# ── Online async mode (runs against the live DB) ──────────────────────────────
def do_run_migrations(connection: Connection) -> None:
    context.configure(
        connection=connection,
        target_metadata=target_metadata,
        include_schemas=True,
        # Compare server_default so Alembic detects default changes
        compare_server_default=True,
    )
    with context.begin_transaction():
        context.run_migrations()


async def run_async_migrations() -> None:
    """Create an async engine, obtain a sync connection, run migrations."""
    connectable = async_engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )
    async with connectable.connect() as connection:
        await connection.run_sync(do_run_migrations)
    await connectable.dispose()


def run_migrations_online() -> None:
    asyncio.run(run_async_migrations())


# ── Entry point ───────────────────────────────────────────────────────────────
if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
