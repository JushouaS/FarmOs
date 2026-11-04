-- 0022_measured_weights.sql
-- The growth curve stops pretending: `cycle_weights` only says what the birds
-- actually weighed on the days someone weighed them.
--
-- Before this, every row carried an "actual" weight that came from the 2024
-- sample dataset — a standard curve with a few grams of decoration on it — and
-- the Dashboard drew those numbers as if a scale had produced them. The
-- standard for each day is real (it comes from the Ross 308 table), so it stays;
-- the weight does not, until a person types one in on Flock Tracking.

ALTER TABLE cycle_weights ALTER COLUMN actual_g DROP NOT NULL;

-- Which half of a row is real. Rows written by a weigh-in are 'measured';
-- everything seeded for the standard is 'standard' and has no actual weight.
ALTER TABLE cycle_weights ADD COLUMN source text NOT NULL DEFAULT 'standard';

UPDATE cycle_weights
   SET actual_g = NULL,
       sample_size = NULL,
       estimation_confidence = NULL,
       source = 'standard';

ALTER TABLE cycle_weights
  ADD CONSTRAINT cycle_weights_source_check CHECK (source IN ('standard', 'measured')),
  -- A measured row is a measurement: it must carry the number that was measured.
  ADD CONSTRAINT cycle_weights_measured_has_value CHECK (source <> 'measured' OR actual_g IS NOT NULL);

CREATE INDEX cycle_weights_measured_idx ON cycle_weights (cycle_id, day) WHERE actual_g IS NOT NULL;

COMMENT ON COLUMN cycle_weights.source IS
  'standard: the breed target for the day, no weigh-in. measured: the mean of the weights typed in that day.';
