-- 0002_farm_infrastructure.sql
-- Facilities, houses, sensors, cameras, sensor bounds and calibrations.
--
-- Design notes:
-- - `facilities.id` and `houses.id` are stable text codes (e.g. 'FARM-001', 'H04')
--   chosen to match the seed dataset and to be readable in URLs and reports.
-- - `sensors.id` is the physical serial-tagged code (e.g. 'SN-241-H4'); the
--   separate `code` column is the console display code ('TEMP_H04').
-- - `sensor_bounds.effective_from/to` time-windows the acceptable range so that
--   historical readings keep their in/out-of-range status at the moment they
--   were recorded, even after standards change.

CREATE TABLE facilities (
    id                  text PRIMARY KEY,
    name                text NOT NULL,
    breed               text NOT NULL,
    house_range_label   text NOT NULL,
    timezone            text NOT NULL DEFAULT 'UTC',
    address             text,
    latitude            numeric,
    longitude           numeric,
    metadata            jsonb,
    created_at          timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE houses (
    id              text PRIMARY KEY,
    facility_id     text NOT NULL REFERENCES facilities(id) ON DELETE RESTRICT,
    label           text NOT NULL,
    section         text NOT NULL,
    population      int NOT NULL,
    sort_order      int NOT NULL DEFAULT 0,
    is_active       bool NOT NULL DEFAULT true,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX houses_facility_idx ON houses (facility_id);

CREATE TABLE sensor_types (
    code            text PRIMARY KEY,
    label           text NOT NULL,
    unit            text NOT NULL,
    display_format  text
);

CREATE TABLE sensors (
    id                      text PRIMARY KEY,
    house_id                text NOT NULL REFERENCES houses(id) ON DELETE RESTRICT,
    sensor_type_code        text NOT NULL REFERENCES sensor_types(code) ON DELETE RESTRICT,
    code                    text UNIQUE NOT NULL,
    label                   text,
    location_x              numeric,
    location_y              numeric,
    serial                  text,
    installed_at            timestamptz,
    decommissioned_at       timestamptz,
    created_at              timestamptz NOT NULL DEFAULT now(),
    updated_at              timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX sensors_house_idx      ON sensors (house_id);
CREATE INDEX sensors_type_idx       ON sensors (sensor_type_code);
CREATE INDEX sensors_active_idx     ON sensors (id) WHERE decommissioned_at IS NULL;

CREATE TABLE sensor_bounds (
    sensor_id           text NOT NULL REFERENCES sensors(id) ON DELETE CASCADE,
    lower_bound         numeric,
    upper_bound         numeric,
    display_label       text NOT NULL,
    effective_from      date NOT NULL DEFAULT CURRENT_DATE,
    effective_to        date,
    PRIMARY KEY (sensor_id, effective_from),
    CONSTRAINT sensor_bounds_range_check CHECK (effective_to IS NULL OR effective_to >= effective_from)
);

CREATE TABLE sensor_calibrations (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    sensor_id       text NOT NULL REFERENCES sensors(id) ON DELETE CASCADE,
    at              timestamptz NOT NULL DEFAULT now(),
    by_user_id      uuid REFERENCES users(id) ON DELETE SET NULL,
    offset_applied  numeric NOT NULL DEFAULT 0,
    reason          text
);

CREATE INDEX sensor_calibrations_sensor_idx ON sensor_calibrations (sensor_id, at DESC);

CREATE TABLE cameras (
    id                      text PRIMARY KEY,
    house_id                text NOT NULL REFERENCES houses(id) ON DELETE RESTRICT,
    mount_x                 numeric,
    mount_y                 numeric,
    fps                     numeric,
    resolution              text,
    depth_points_per_frame  int,
    plan_view_label         text,
    still_url               text,
    online                  bool NOT NULL DEFAULT false,
    last_heartbeat_at       timestamptz,
    created_at              timestamptz NOT NULL DEFAULT now(),
    updated_at              timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX cameras_house_idx ON cameras (house_id);

CREATE TABLE camera_clips (
    id                  text PRIMARY KEY,
    camera_id           text NOT NULL REFERENCES cameras(id) ON DELETE CASCADE,
    recorded_at         timestamptz NOT NULL,
    duration_sec        int,
    file_url            text NOT NULL,
    storage_path        text,
    bytes               bigint,
    retention_until     timestamptz,
    created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX camera_clips_camera_idx ON camera_clips (camera_id, recorded_at DESC);
CREATE INDEX camera_clips_retention_idx ON camera_clips (retention_until) WHERE retention_until IS NOT NULL;
