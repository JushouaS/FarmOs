-- 0005_vision_and_detections.sql
-- Live feed artefacts: per-frame detections, cluster warnings, behaviour
-- snapshots, volumetric samples from the depth rig.

CREATE TABLE detections (
    id                      text PRIMARY KEY,
    camera_id               text NOT NULL REFERENCES cameras(id) ON DELETE CASCADE,
    frame_at                timestamptz NOT NULL,
    box_x                   numeric NOT NULL,
    box_y                   numeric NOT NULL,
    box_w                   numeric NOT NULL,
    box_h                   numeric NOT NULL,
    behavior                text NOT NULL,
    estimated_weight_g      numeric,
    weight_confidence       numeric,
    flag                    text
);

CREATE INDEX detections_camera_time_idx ON detections (camera_id, frame_at DESC);
CREATE INDEX detections_flag_idx        ON detections (flag) WHERE flag IS NOT NULL;

CREATE TABLE cluster_warnings (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    camera_id           text NOT NULL REFERENCES cameras(id) ON DELETE CASCADE,
    raised_at           timestamptz NOT NULL DEFAULT now(),
    label               text NOT NULL,
    risk                numeric NOT NULL,
    box                 jsonb NOT NULL,
    acknowledged_by     uuid REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT cluster_warnings_risk_check CHECK (risk >= 0 AND risk <= 1)
);

CREATE INDEX cluster_warnings_camera_idx ON cluster_warnings (camera_id, raised_at DESC);

CREATE TABLE behavior_snapshots (
    id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    camera_id               text NOT NULL REFERENCES cameras(id) ON DELETE CASCADE,
    at                      timestamptz NOT NULL DEFAULT now(),
    movement_index          numeric,
    movement_label          text,
    movement_status         text,
    huddling_risk           numeric,
    huddling_label          text,
    huddling_status         text,
    aggression_events       int NOT NULL DEFAULT 0
);

CREATE INDEX behavior_snapshots_camera_idx ON behavior_snapshots (camera_id, at DESC);

CREATE TABLE volumetric_samples (
    id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    sensor_id               text NOT NULL REFERENCES sensors(id) ON DELETE RESTRICT,
    cohort_id               text REFERENCES cohorts(id) ON DELETE SET NULL,
    breast_width_mm         numeric,
    total_length_mm         numeric,
    depth_z_mm              numeric,
    calculated_mass_g       numeric,
    morphological_index     numeric,
    density_ratio           numeric,
    precision_percent       numeric,
    sampled_at              timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX volumetric_samples_cohort_idx ON volumetric_samples (cohort_id, sampled_at DESC);
CREATE INDEX volumetric_samples_sensor_idx ON volumetric_samples (sensor_id, sampled_at DESC);
