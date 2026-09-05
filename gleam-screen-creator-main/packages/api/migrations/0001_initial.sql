-- 0001_initial.sql
-- Authentication, users, roles, permissions, sessions, password resets, auth audit.
--
-- Design notes:
-- - `users.id` is a UUID, generated server-side; email is the natural key.
-- - Passwords are hashed with bcrypt; the column stores the full $2b$... string.
-- - `sessions.access_token` is the short-lived JWT; `refresh_token` is a random
--   opaque string with its own expiry. Both indexed for lookup.
-- - `auth_audit` is append-only; no UPDATE/DELETE triggers on it.

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS citext;

CREATE TABLE users (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    email           citext UNIQUE NOT NULL,
    password_hash   text NOT NULL,
    full_name       text,
    phone           text,
    avatar_url      text,
    last_login_at   timestamptz,
    is_active       bool NOT NULL DEFAULT true,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX users_email_active_idx ON users (email) WHERE is_active;

CREATE TABLE roles (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    code            text UNIQUE NOT NULL,
    name            text NOT NULL,
    description     text
);

CREATE TABLE user_roles (
    user_id         uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role_id         uuid NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
    PRIMARY KEY (user_id, role_id)
);

CREATE TABLE permissions (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    code            text UNIQUE NOT NULL,
    resource        text NOT NULL,
    action          text NOT NULL
);

CREATE TABLE role_permissions (
    role_id         uuid NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
    permission_id   uuid NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
    PRIMARY KEY (role_id, permission_id)
);

CREATE TABLE sessions (
    id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id                 uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    access_token            text UNIQUE NOT NULL,
    refresh_token           text UNIQUE NOT NULL,
    refresh_expires_at      timestamptz NOT NULL,
    ip_address              inet,
    user_agent              text,
    created_at              timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX sessions_user_idx          ON sessions (user_id);
CREATE INDEX sessions_access_token_idx  ON sessions (access_token);
CREATE INDEX sessions_refresh_token_idx ON sessions (refresh_token);
CREATE INDEX sessions_refresh_expiry_idx ON sessions (refresh_expires_at);

CREATE TABLE password_resets (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash      text UNIQUE NOT NULL,
    expires_at      timestamptz NOT NULL,
    used_at         timestamptz,
    created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE auth_audit (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         uuid REFERENCES users(id) ON DELETE SET NULL,
    action          text NOT NULL,
    ip_address      inet,
    metadata        jsonb,
    at              timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX auth_audit_user_idx ON auth_audit (user_id, at DESC);
CREATE INDEX auth_audit_action_idx ON auth_audit (action, at DESC);

-- Seed the role catalogue.
INSERT INTO roles (code, name, description) VALUES
    ('ADMIN',         'Administrator', 'Full access to all resources and configuration.'),
    ('FARM_MANAGER',  'Farm Manager',  'Operational access to the farm; can acknowledge alerts and close incidents.'),
    ('OPERATOR',      'Operator',      'Day-to-day operator; read-mostly with the ability to acknowledge alerts.'),
    ('VIEWER',        'Viewer',        'Read-only access to dashboards and reports.');
