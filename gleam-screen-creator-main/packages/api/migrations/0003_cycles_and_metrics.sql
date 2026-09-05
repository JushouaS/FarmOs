-- 0003_cycles_and_metrics.sql
-- Flock cycles, growth curve, cohorts, feed/water/activity samples.

CREATE TABLE flock_cycles (
    id                      text PRIMARY KEY,
    facility_id             text NOT NULL REFERENCES facilities(id) ON DELETE RESTRICT,
    label                   text NOT NULL,
    breed                   text,
    start_date              date NOT NULL,
    projected_yield_date    date,
    ended_at                timestamptz,
    status                  text NOT NULL DEFAULT 'active'
                                CHECK (status IN ('active', 'completed', 'abandoned')),
    created_at              timestamptz NOT NULL DEFAULT now(),
    updated_at              timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX flock_cycles_facility_idx ON flock_cycles (facility_id);
CREATE INDEX flock_cycles_active_idx   ON flock_cycles (facility_id) WHERE status = 'active';

-- One point per sampled grow-out day.
CREATE TABLE cycle_weights (
    cycle_id                text NOT NULL REFERENCES flock_cycles(id) ON DELETE CASCADE,
    day                     int NOT NULL,
    actual_g                numeric NOT NULL,
    standard_g              numeric NOT NULL,
    sample_size             int,
    estimation_confidence   numeric,
    recorded_at             timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (cycle_id, day),
    CONSTRAINT cycle_weights_day_check CHECK (day >= 0)
);

CREATE TABLE cohorts (
    id                      text PRIMARY KEY,
    cycle_id                text NOT NULL REFERENCES flock_cycles(id) ON DELETE CASCADE,
    house_id                text NOT NULL REFERENCES houses(id) ON DELETE RESTRICT,
    min_g                   numeric NOT NULL,
    max_g                   numeric NOT NULL,
    standard_deviation_g    numeric NOT NULL,
    median_g                numeric NOT NULL,
    status                  text NOT NULL,
    created_at              timestamptz NOT NULL DEFAULT now(),
    updated_at              timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT cohorts_range_check CHECK (max_g >= min_g)
);

CREATE INDEX cohorts_cycle_idx ON cohorts (cycle_id);
CREATE INDEX cohorts_house_idx ON cohorts (house_id);

CREATE TABLE feed_samples (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    cycle_id        text NOT NULL REFERENCES flock_cycles(id) ON DELETE CASCADE,
    day             int NOT NULL,
    fcr             numeric,
    adg_g           numeric,
    consumed_kg     numeric,
    recorded_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX feed_samples_cycle_idx ON feed_samples (cycle_id, recorded_at DESC);

CREATE TABLE water_samples (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    cycle_id            text NOT NULL REFERENCES flock_cycles(id) ON DELETE CASCADE,
    litres_per_hour     numeric NOT NULL,
    status              text NOT NULL,
    recorded_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX water_samples_cycle_idx ON water_samples (cycle_id, recorded_at DESC);

CREATE TABLE activity_samples (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    cycle_id        text NOT NULL REFERENCES flock_cycles(id) ON DELETE CASCADE,
    value           numeric NOT NULL,
    unit            text NOT NULL DEFAULT 'IDX',
    recorded_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX activity_samples_cycle_idx ON activity_samples (cycle_id, recorded_at DESC);
