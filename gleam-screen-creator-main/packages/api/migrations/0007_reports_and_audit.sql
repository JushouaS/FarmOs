-- 0007_reports_and_audit.sql
-- Monitoring reports, per-report findings, reference docs cited by the LLM,
-- archived exports, and the append-only audit log.

CREATE TABLE monitoring_reports (
    id                  text PRIMARY KEY,
    facility_id         text NOT NULL REFERENCES facilities(id) ON DELETE RESTRICT,
    grounding_id        text UNIQUE NOT NULL,
    generated_at        timestamptz NOT NULL DEFAULT now(),
    last_scan_at        timestamptz NOT NULL,
    generated_by        uuid REFERENCES users(id) ON DELETE SET NULL,
    created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX monitoring_reports_facility_idx ON monitoring_reports (facility_id, generated_at DESC);

CREATE TABLE report_findings (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    report_id       text NOT NULL REFERENCES monitoring_reports(id) ON DELETE CASCADE,
    parameter       text NOT NULL,
    source_label    text NOT NULL,
    value           numeric NOT NULL,
    unit            text NOT NULL,
    bounds_label    text NOT NULL,
    status          text NOT NULL,
    sort_order      int NOT NULL DEFAULT 0
);

CREATE INDEX report_findings_report_idx ON report_findings (report_id, sort_order);

CREATE TABLE reference_docs (
    id                  text PRIMARY KEY,
    quote               text NOT NULL,
    cited_threshold     numeric,
    unit                text,
    document_ref        text,
    created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE archived_reports (
    id              text PRIMARY KEY,
    title           text NOT NULL,
    format          text NOT NULL,
    generated_at    timestamptz NOT NULL,
    size_mb         numeric,
    is_featured     bool NOT NULL DEFAULT false,
    note            text,
    file_url        text,
    created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX archived_reports_generated_idx ON archived_reports (generated_at DESC);
CREATE INDEX archived_reports_featured_idx  ON archived_reports (id) WHERE is_featured;

-- Append-only. Every mutating service path writes here; no UPDATE/DELETE allowed
-- by the application role.
CREATE TABLE audit_log (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         uuid REFERENCES users(id) ON DELETE SET NULL,
    action          text NOT NULL,
    resource_type   text NOT NULL,
    resource_id     text,
    before_value    jsonb,
    after_value     jsonb,
    at              timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX audit_log_user_idx     ON audit_log (user_id, at DESC);
CREATE INDEX audit_log_resource_idx ON audit_log (resource_type, resource_id, at DESC);
CREATE INDEX audit_log_action_idx   ON audit_log (action, at DESC);
