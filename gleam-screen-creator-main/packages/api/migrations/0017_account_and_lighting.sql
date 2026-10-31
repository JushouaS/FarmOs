-- 0017_account_and_lighting.sql
-- Two settings that were fixed in code until now.
--
-- users.analysis_language: the language the Live Camera analysis shows in
--   (en, tl = Tagalog, ceb = Cebuano). Follows the person across devices.
-- system_settings 'lighting': when the day starts and when the night starts
--   (local time, HH:MM). Birds count as sleeping at night, so this drives the
--   day/night split on Live Camera and in the analysis.

ALTER TABLE users
    ADD COLUMN analysis_language text NOT NULL DEFAULT 'en'
        CONSTRAINT users_analysis_language_check CHECK (analysis_language IN ('en', 'tl', 'ceb'));

INSERT INTO system_settings (key, value)
VALUES ('lighting', jsonb_build_object('dayStart', '05:00', 'nightStart', '17:00'))
ON CONFLICT (key) DO NOTHING;
