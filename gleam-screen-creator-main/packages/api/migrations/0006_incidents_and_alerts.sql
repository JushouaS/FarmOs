-- 0006_incidents_and_alerts.sql
-- Incident lifecycle, peak excursion detail, sensor evidence, alert stream,
-- alert action history, 24h anomaly timeline.

CREATE TABLE incidents (
    id                      text PRIMARY KEY,
    house_id                text NOT NULL REFERENCES houses(id) ON DELETE RESTRICT,
    title                   text,
    started_at              timestamptz NOT NULL,
    ended_at                timestamptz,
    exceedance_minutes      int,
    activity_drop_percent   numeric,
    cause                   text,
    resolution              text,
    status                  text NOT NULL DEFAULT 'open'
                                CHECK (status IN ('open', 'resolved_monitoring', 'closed')),
    created_at              timestamptz NOT NULL DEFAULT now(),
    updated_at              timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT incidents_time_check CHECK (ended_at IS NULL OR ended_at >= started_at)
);

CREATE INDEX incidents_house_idx  ON incidents (house_id, started_at DESC);
CREATE INDEX incidents_status_idx ON incidents (status) WHERE status <> 'closed';

CREATE TABLE incident_peaks (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    incident_id     text UNIQUE NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
    sensor_id       text NOT NULL REFERENCES sensors(id) ON DELETE RESTRICT,
    parameter       text NOT NULL,
    value           numeric NOT NULL,
    unit            text NOT NULL,
    threshold       numeric NOT NULL,
    baseline        numeric NOT NULL
);

-- The peak.series array, stored row-by-row for analytic queries.
CREATE TABLE incident_peak_series (
    incident_id     text NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
    sample_index    int NOT NULL,
    value           numeric NOT NULL,
    PRIMARY KEY (incident_id, sample_index)
);

CREATE TABLE incident_evidence (
    id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    incident_id             text UNIQUE NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
    camera_id               text NOT NULL REFERENCES cameras(id) ON DELETE RESTRICT,
    clip_id                 text,
    captured_at             timestamptz NOT NULL,
    detection_label         text,
    detection_confidence    numeric,
    image_url               text
);

CREATE TABLE alerts (
    id                      text PRIMARY KEY,
    facility_id             text NOT NULL REFERENCES facilities(id) ON DELETE RESTRICT,
    kind                    text NOT NULL,
    severity                text NOT NULL,
    message                 text NOT NULL,
    raised_at               timestamptz NOT NULL DEFAULT now(),
    acknowledged            bool NOT NULL DEFAULT false,
    acknowledged_by         uuid REFERENCES users(id) ON DELETE SET NULL,
    acknowledged_at         timestamptz,
    source_incident_id      text REFERENCES incidents(id) ON DELETE SET NULL,
    CONSTRAINT alerts_ack_check CHECK (NOT (acknowledged AND acknowledged_at IS NULL))
);

CREATE INDEX alerts_facility_unack_idx ON alerts (facility_id, raised_at DESC)
    WHERE acknowledged = false;
CREATE INDEX alerts_facility_idx       ON alerts (facility_id, raised_at DESC);
CREATE INDEX alerts_incident_idx       ON alerts (source_incident_id)
    WHERE source_incident_id IS NOT NULL;

CREATE TABLE alert_history (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    alert_id        text NOT NULL REFERENCES alerts(id) ON DELETE CASCADE,
    action          text NOT NULL,
    by_user_id      uuid REFERENCES users(id) ON DELETE SET NULL,
    at              timestamptz NOT NULL DEFAULT now(),
    metadata        jsonb
);

CREATE INDEX alert_history_alert_idx ON alert_history (alert_id, at DESC);

CREATE TABLE anomaly_events (
    id                      text PRIMARY KEY,
    facility_id             text NOT NULL REFERENCES facilities(id) ON DELETE RESTRICT,
    at                      timestamptz NOT NULL,
    severity                text NOT NULL,
    label                   text NOT NULL,
    source_incident_id      text REFERENCES incidents(id) ON DELETE SET NULL
);

CREATE INDEX anomaly_events_facility_idx ON anomaly_events (facility_id, at);
