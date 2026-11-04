-- 0021_behavior_counts_and_zones.sql
-- Real behaviour classification for CAM-01 (inactivity / huddling).
--
-- camera_zones: areas of the picture an operator marks by hand — feeders and
--   drinkers. Birds standing in one are feeding, so they are left out of the
--   huddling calculation (crowding at a feeder is expected, not a welfare
--   signal). They stay in the inactivity count, because a bird that does not
--   move at a feeder can still be unwell. Polygons are stored normalised to
--   0..1 of the frame, so a camera that reconnects at another resolution does
--   not invalidate them.
--
-- behavior_snapshots gains the counts behind its existing labels: a label
--   alone cannot be checked afterwards, "12 of 34 birds inactive" can. It
--   also records whether the night rule suppressed the judgement, so the
--   record shows the exception fired instead of quietly hiding it.

CREATE TABLE camera_zones (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    camera_id   text NOT NULL REFERENCES cameras(id) ON DELETE CASCADE,
    kind        text NOT NULL DEFAULT 'feeder'
                CONSTRAINT camera_zones_kind_check CHECK (kind IN ('feeder', 'drinker')),
    label       text NOT NULL,
    /* [[x, y], ...] normalised 0..1; at least a triangle. */
    polygon     jsonb NOT NULL,
    enabled     boolean NOT NULL DEFAULT true,
    created_by  uuid REFERENCES users(id) ON DELETE SET NULL,
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX camera_zones_camera_idx ON camera_zones (camera_id) WHERE enabled;

ALTER TABLE behavior_snapshots
    ADD COLUMN bird_count      int,
    ADD COLUMN zone_count      int,
    ADD COLUMN evaluable_count int,
    ADD COLUMN inactive_count  int,
    ADD COLUMN huddled_count   int,
    ADD COLUMN confidence      numeric,
    ADD COLUMN night           boolean NOT NULL DEFAULT false,
    ADD COLUMN suppressed      boolean NOT NULL DEFAULT false,
    ADD COLUMN reliable        boolean NOT NULL DEFAULT true;

-- The rolling window (sustained inactivity / huddling) reads the newest rows
-- for one camera, which behavior_snapshots_camera_idx already covers.
