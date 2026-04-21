-- migrate:up
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('root', 'operator')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL UNIQUE,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_seen_at TIMESTAMPTZ,
    revoked_at TIMESTAMPTZ,
    user_agent TEXT,
    ip_address TEXT
);

CREATE INDEX sessions_user_id_idx ON sessions(user_id);
CREATE INDEX sessions_expires_at_idx ON sessions(expires_at);

CREATE TABLE rooms (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    slug TEXT NOT NULL UNIQUE,
    display_name TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('starting', 'running', 'stopped', 'degraded', 'failed')),
    desired_state TEXT NOT NULL CHECK (desired_state IN ('running', 'stopped')),
    created_by_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE room_runtime_metadata (
    room_id UUID PRIMARY KEY REFERENCES rooms(id) ON DELETE CASCADE,
    port INTEGER,
    pid INTEGER,
    config_version INTEGER NOT NULL DEFAULT 1,
    token_version INTEGER NOT NULL DEFAULT 1,
    health_status TEXT NOT NULL CHECK (health_status IN ('unknown', 'healthy', 'unhealthy')) DEFAULT 'unknown',
    started_at TIMESTAMPTZ,
    last_health_at TIMESTAMPTZ,
    last_error TEXT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE secrets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    key_name TEXT NOT NULL UNIQUE,
    cipher_text BYTEA NOT NULL,
    nonce BYTEA NOT NULL,
    auth_tag BYTEA NOT NULL,
    key_version INTEGER NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE room_entitlements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    room_id UUID NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK (kind IN ('provider_credential', 'mail', 'calendar', 'github', 'mcp', 'webhook')),
    provider TEXT NOT NULL,
    account_id TEXT,
    server_id TEXT,
    scope JSONB NOT NULL DEFAULT '{}'::jsonb,
    secret_id UUID REFERENCES secrets(id) ON DELETE SET NULL,
    status TEXT NOT NULL CHECK (status IN ('active', 'revoked')) DEFAULT 'active',
    version INTEGER NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX room_entitlements_room_id_idx ON room_entitlements(room_id);
CREATE INDEX room_entitlements_kind_idx ON room_entitlements(kind);

CREATE TABLE artifact_index (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    room_id UUID NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    artifact_id TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('attachment', 'artifact')),
    sha256 TEXT NOT NULL,
    byte_length BIGINT NOT NULL,
    media_type TEXT NOT NULL,
    manifest_path TEXT NOT NULL,
    source JSONB NOT NULL DEFAULT '{}'::jsonb,
    provenance JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_by TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(room_id, artifact_id)
);

CREATE INDEX artifact_index_room_id_idx ON artifact_index(room_id);
CREATE INDEX artifact_index_sha_idx ON artifact_index(sha256);

CREATE TABLE audit_events (
    id BIGSERIAL PRIMARY KEY,
    actor_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    room_id UUID REFERENCES rooms(id) ON DELETE SET NULL,
    action TEXT NOT NULL,
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX audit_events_room_id_idx ON audit_events(room_id);
CREATE INDEX audit_events_action_idx ON audit_events(action);

-- migrate:down
DROP INDEX IF EXISTS audit_events_action_idx;
DROP INDEX IF EXISTS audit_events_room_id_idx;
DROP TABLE IF EXISTS audit_events;

DROP INDEX IF EXISTS artifact_index_sha_idx;
DROP INDEX IF EXISTS artifact_index_room_id_idx;
DROP TABLE IF EXISTS artifact_index;

DROP INDEX IF EXISTS room_entitlements_kind_idx;
DROP INDEX IF EXISTS room_entitlements_room_id_idx;
DROP TABLE IF EXISTS room_entitlements;

DROP TABLE IF EXISTS secrets;
DROP TABLE IF EXISTS room_runtime_metadata;
DROP TABLE IF EXISTS rooms;

DROP INDEX IF EXISTS sessions_expires_at_idx;
DROP INDEX IF EXISTS sessions_user_id_idx;
DROP TABLE IF EXISTS sessions;

DROP TABLE IF EXISTS users;
