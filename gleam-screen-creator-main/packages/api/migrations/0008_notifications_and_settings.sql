-- 0008_notifications_and_settings.sql
-- User notifications, delivery preferences, platform heartbeat row, and
-- free-form system settings.

CREATE TABLE notifications (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id             uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title               text NOT NULL,
    body                text NOT NULL,
    channel             text NOT NULL CHECK (channel IN ('in_app', 'email', 'push', 'sms')),
    kind                text,
    severity            text,
    related_id          uuid,
    read_at             timestamptz,
    delivered_at        timestamptz,
    failed_at           timestamptz,
    failure_reason      text,
    created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX notifications_user_unread_idx ON notifications (user_id, created_at DESC)
    WHERE read_at IS NULL;
CREATE INDEX notifications_user_idx        ON notifications (user_id, created_at DESC);

CREATE TABLE notification_preferences (
    user_id             uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    channel             text NOT NULL CHECK (channel IN ('in_app', 'email', 'push', 'sms')),
    enabled             bool NOT NULL DEFAULT true,
    min_severity        text NOT NULL DEFAULT 'deviation',
    quiet_hours_start   time,
    quiet_hours_end     time,
    updated_at          timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, channel)
);

-- Singleton row: updated by a heartbeat worker; id constrained to 1.
CREATE TABLE platform_status (
    id                  int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    app_version         text,
    release_channel     text,
    api_version         text,
    ml_model            text,
    llm                 text,
    cpu_percent         numeric,
    ram_gb              numeric,
    status              text NOT NULL DEFAULT 'nominal',
    sampled_at          timestamptz NOT NULL DEFAULT now()
);

INSERT INTO platform_status (app_version, release_channel, api_version, ml_model, llm, status)
VALUES ('2.4.0', 'STABLE', 'v1.2', 'v4', 'LLAMA_3.3', 'nominal')
ON CONFLICT DO NOTHING;

CREATE TABLE system_settings (
    key             text PRIMARY KEY,
    value           jsonb NOT NULL,
    updated_at      timestamptz NOT NULL DEFAULT now(),
    updated_by      uuid REFERENCES users(id) ON DELETE SET NULL
);
