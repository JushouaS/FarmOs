-- 0016_cycle_day_setting.sql
-- The grow-out day is a setting, not a date baked into the seed: the flock is
-- on `startDay` (default 16) on the day `startedOn`, then counts up one day per
-- day to the end of the grow-out (day 45). Changing it in Settings rewrites
-- this one row; every page reads the day from here through /operations/overview.

INSERT INTO system_settings (key, value)
VALUES (
    'cycle',
    jsonb_build_object('startDay', 16, 'startedOn', to_char(CURRENT_DATE, 'YYYY-MM-DD'))
)
ON CONFLICT (key) DO NOTHING;
