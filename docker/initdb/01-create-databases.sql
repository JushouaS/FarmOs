-- Two independent schemas live on one PostgreSQL instance:
--   farmos   — Fastify API (packages/api migrations, created by POSTGRES_DB)
--   cerebroil — FastAPI telemetry backend (Alembic migrations)
--
-- POSTGRES_DB already creates `farmos`, so only the second database needs
-- creating here. `\gexec` keeps the statement idempotent for restarts against
-- a volume that already holds the databases.
SELECT 'CREATE DATABASE cerebroil OWNER ' || quote_ident(current_user)
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'cerebroil')\gexec
