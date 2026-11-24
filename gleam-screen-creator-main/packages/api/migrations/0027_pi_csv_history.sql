CREATE TABLE pi_ammonia_logs (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    recorded_at     timestamptz NOT NULL,
    ammonia_ppm     numeric,
    error           text,
    source_file     text NOT NULL,
    source_row      integer NOT NULL,
    UNIQUE (source_file, source_row)
);

CREATE INDEX pi_ammonia_logs_time_idx ON pi_ammonia_logs (recorded_at DESC);

CREATE TABLE pi_behavior_logs (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    recorded_at     timestamptz NOT NULL,
    birds           integer,
    still_birds     integer,
    huddled_birds   integer,
    flock_moving    numeric,
    huddle_fdi      numeric,
    error           text,
    source_file     text NOT NULL,
    source_row      integer NOT NULL,
    UNIQUE (source_file, source_row)
);

CREATE INDEX pi_behavior_logs_time_idx ON pi_behavior_logs (recorded_at DESC);
