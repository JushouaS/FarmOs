-- 0020_actual_weights.sql
-- The weight a person measured for one bird on one grow-out day (Flock Tracking),
-- kept next to the estimate shown at that moment so the two can be compared.

CREATE TABLE actual_weights (
    cycle_id        text NOT NULL REFERENCES flock_cycles(id) ON DELETE CASCADE,
    bird_id         text NOT NULL,
    day             int  NOT NULL,
    actual_g        numeric(7,1) NOT NULL,
    estimated_g     numeric(7,1),
    recorded_by     uuid REFERENCES users(id) ON DELETE SET NULL,
    recorded_at     timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (cycle_id, bird_id, day),
    CONSTRAINT actual_weights_day_range CHECK (day BETWEEN 1 AND 100),
    CONSTRAINT actual_weights_positive  CHECK (actual_g > 0 AND actual_g <= 8000)
);

CREATE INDEX actual_weights_day_idx ON actual_weights (cycle_id, day);
