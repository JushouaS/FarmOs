-- 0010_security_mfa_lockout.sql
-- Adds MFA enrollment, backup codes, and account lockout columns to support
-- the advanced security implementation.

ALTER TABLE users
    ADD COLUMN IF NOT EXISTS failed_login_attempts int NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS locked_until timestamptz,
    ADD COLUMN IF NOT EXISTS mfa_enabled bool NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS mfa_secret text,
    ADD COLUMN IF NOT EXISTS mfa_backup_codes text[] NOT NULL DEFAULT '{}';

CREATE INDEX IF NOT EXISTS users_locked_until_idx ON users (locked_until) WHERE locked_until IS NOT NULL;
