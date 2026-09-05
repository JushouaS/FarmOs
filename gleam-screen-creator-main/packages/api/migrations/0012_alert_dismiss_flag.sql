-- 0012_alert_dismiss_flag.sql
-- H-2 fix: adds a separate dismissed flag to alerts so dismiss and acknowledge
-- remain distinguishable in the DB and audit trail.

ALTER TABLE alerts
    ADD COLUMN IF NOT EXISTS dismissed       bool        NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS dismissed_at    timestamptz,
    ADD COLUMN IF NOT EXISTS dismissed_by    uuid REFERENCES users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS alerts_dismissed_idx ON alerts (dismissed) WHERE dismissed = false;
