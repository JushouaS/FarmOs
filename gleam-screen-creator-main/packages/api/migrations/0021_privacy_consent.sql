-- 0021_privacy_consent.sql
-- Who agreed to the Privacy Policy, when, and to which version of it. One row per
-- person and version, so a new version of the policy asks everyone again while the
-- earlier agreements stay on record.

CREATE TABLE privacy_consents (
    user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    version      text NOT NULL,
    accepted_at  timestamptz NOT NULL DEFAULT now(),
    ip_address   inet,
    PRIMARY KEY (user_id, version)
);
