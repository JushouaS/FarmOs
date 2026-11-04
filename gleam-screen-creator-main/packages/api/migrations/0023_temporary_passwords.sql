-- 0023_temporary_passwords.sql
-- A password an administrator hands out is temporary: it must be replaced at the first sign-in,
-- and it stops working after a time if nobody has used it.

ALTER TABLE users
    ADD COLUMN must_change_password boolean NOT NULL DEFAULT false,
    ADD COLUMN password_expires_at  timestamptz;
