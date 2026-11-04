-- 0022_login_failures.sql
-- Wrong passwords and wrong second-step codes, so too many attempts can be refused.
--
-- The subject is the email that was tried (lower case), or "mfa:" and the account id for
-- the second step. The password lock is per subject and per network address: someone
-- guessing from one address is stopped without locking the real person out from theirs.
-- Rows for emails that have no account are kept the same way, so an outsider cannot tell
-- from the answers which emails have accounts.

CREATE TABLE login_failures (
    id          bigserial PRIMARY KEY,
    subject     text NOT NULL,
    ip_address  inet,
    failed_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX login_failures_subject_idx ON login_failures (subject, failed_at DESC);
