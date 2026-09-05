-- 0004_timeseries.sql
-- `sensor_readings` is the largest table. Starts as a plain table; promotion
-- to declarative monthly partitioning (or a TimescaleDB hypertable) is deferred
-- to a future migration once ingestion volume justifies it.
--
-- The schema keeps `status` as a first-class column so that alert dashboards
-- ("show me every current warning") do not need to re-evaluate bounds on the
-- fly.

CREATE TABLE sensor_readings (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    sensor_id       text NOT NULL REFERENCES sensors(id) ON DELETE RESTRICT,
    value           numeric NOT NULL,
    unit            text NOT NULL,
    status          text NOT NULL,
    recorded_at     timestamptz NOT NULL,
    ingested_at     timestamptz NOT NULL DEFAULT now()
);

-- Primary timeseries lookup: latest readings for one sensor.
CREATE INDEX sensor_readings_sensor_time_idx
    ON sensor_readings (sensor_id, recorded_at DESC);

-- Dashboard and alert queries: "current warnings across the farm".
CREATE INDEX sensor_readings_status_time_idx
    ON sensor_readings (status, recorded_at DESC)
    WHERE status IN ('warning', 'critical', 'deviation');
