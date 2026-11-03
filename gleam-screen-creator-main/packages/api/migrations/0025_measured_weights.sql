-- 0025_measured_weights.sql
-- cycle_weights held two things in one row: the breed's standard weight for a day (reference data)
-- and the flock's "actual" weight (a measurement). The seed (0009) filled both for seven days of an
-- April-May 2024 cycle, and nothing ever wrote a measurement, so the Dashboard drew that sample as if
-- it were the flock.
--
-- From here a row's actual_g is a measurement or it is empty:
--   * actual_g may be NULL (the row is then only the standard for that day);
--   * source says where a measurement came from ('scale': the mean of the weights typed in on Flock
--     Tracking for that day, kept up to date by the API in measured-weights.ts);
--   * the 2024 sample measurements are cleared, the standards are kept.

ALTER TABLE cycle_weights ALTER COLUMN actual_g DROP NOT NULL;
ALTER TABLE cycle_weights ADD COLUMN IF NOT EXISTS source text;

-- The 2024 sample measurements go first, so the rules below hold for every row that is left.
UPDATE cycle_weights
   SET actual_g = NULL, sample_size = NULL, estimation_confidence = NULL, source = NULL
 WHERE source IS NULL AND recorded_at < '2025-01-01';

ALTER TABLE cycle_weights DROP CONSTRAINT IF EXISTS cycle_weights_source_check;
ALTER TABLE cycle_weights ADD CONSTRAINT cycle_weights_source_check CHECK (source IS NULL OR source IN ('scale'));
ALTER TABLE cycle_weights DROP CONSTRAINT IF EXISTS cycle_weights_measurement_check;
ALTER TABLE cycle_weights ADD CONSTRAINT cycle_weights_measurement_check
    CHECK (actual_g IS NULL OR (actual_g > 0 AND source IS NOT NULL));
