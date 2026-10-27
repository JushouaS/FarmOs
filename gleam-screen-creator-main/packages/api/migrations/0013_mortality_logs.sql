-- 0013_mortality_logs.sql
-- Mortality rate was one of the five core broiler metrics this system is
-- meant to track, but no table for it existed anywhere in this schema (it
-- only existed in the separate, unused cerebroil-backend service). This adds
-- a minimal daily mortality log per cycle/house, with a mortality-spike rule
-- mirrored from cerebroil-backend's weight_service.py (delta >= 3 -> alert).
--
-- Populated today by: POST /visual/analyze/:cameraId (see vision-proxy.ts),
-- which derives daily_count from (previous estimated_alive - current
-- estimated_alive) the same way cerebroil-backend does. A dedicated manual
-- entry endpoint can be added later if a farm manager needs to log deaths
-- found without a camera event.

CREATE TABLE mortality_logs (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    cycle_id            text NOT NULL REFERENCES flock_cycles(id) ON DELETE CASCADE,
    house_id            text NOT NULL REFERENCES houses(id) ON DELETE RESTRICT,
    day                 int NOT NULL,
    daily_count         int NOT NULL DEFAULT 0,
    cumulative_count    int NOT NULL DEFAULT 0,
    estimated_alive     int,
    recorded_at         timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT mortality_logs_cycle_day_key UNIQUE (cycle_id, house_id, day),
    CONSTRAINT mortality_logs_daily_nonneg CHECK (daily_count >= 0),
    CONSTRAINT mortality_logs_cumulative_nonneg CHECK (cumulative_count >= 0),
    CONSTRAINT mortality_logs_alive_nonneg CHECK (estimated_alive IS NULL OR estimated_alive >= 0)
);

CREATE INDEX mortality_logs_cycle_idx ON mortality_logs (cycle_id, recorded_at DESC);
CREATE INDEX mortality_logs_house_idx ON mortality_logs (house_id, recorded_at DESC);

-- Baseline row so the dashboard isn't empty immediately after this migration
-- (Day 14 matches the current seed dataset's cycle day; zero deaths assumed
-- until the first real /analyze call records an actual delta).
INSERT INTO mortality_logs (cycle_id, house_id, day, daily_count, cumulative_count, estimated_alive)
VALUES ('FC-2024-07', 'H01', 14, 0, 0, 4210)
ON CONFLICT (cycle_id, house_id, day) DO NOTHING;
