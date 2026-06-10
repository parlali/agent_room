-- migrate:up
CREATE TABLE app_github_manifest_sessions (
    state_hash TEXT PRIMARY KEY,
    actor_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    public_origin TEXT NOT NULL,
    target_owner TEXT,
    status TEXT NOT NULL CHECK (status IN ('pending', 'completed', 'expired', 'failed')) DEFAULT 'pending',
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX app_github_manifest_sessions_expires_at_idx
ON app_github_manifest_sessions(expires_at);

CREATE TABLE app_github_apps (
    id BOOLEAN PRIMARY KEY DEFAULT true CHECK (id),
    app_id TEXT NOT NULL,
    slug TEXT NOT NULL,
    name TEXT NOT NULL,
    client_id TEXT NOT NULL,
    client_secret_secret_id UUID NOT NULL REFERENCES secrets(id) ON DELETE RESTRICT,
    private_key_secret_id UUID NOT NULL REFERENCES secrets(id) ON DELETE RESTRICT,
    webhook_secret_secret_id UUID REFERENCES secrets(id) ON DELETE SET NULL,
    html_url TEXT,
    status TEXT NOT NULL CHECK (status IN ('ready', 'invalid')) DEFAULT 'ready',
    validation_message TEXT,
    last_validated_at TIMESTAMPTZ,
    created_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE app_github_installations (
    installation_id TEXT PRIMARY KEY,
    account_login TEXT NOT NULL,
    account_type TEXT NOT NULL,
    target_type TEXT,
    html_url TEXT,
    repository_selection TEXT NOT NULL DEFAULT 'selected',
    permissions JSONB NOT NULL DEFAULT '{}'::jsonb,
    suspended_at TIMESTAMPTZ,
    status TEXT NOT NULL CHECK (status IN ('ready', 'invalid')) DEFAULT 'ready',
    last_synced_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX app_github_installations_account_idx
ON app_github_installations(account_login);

CREATE TABLE room_github_bindings (
    room_id UUID PRIMARY KEY REFERENCES rooms(id) ON DELETE CASCADE,
    installation_id TEXT NOT NULL REFERENCES app_github_installations(installation_id) ON DELETE RESTRICT,
    repositories JSONB NOT NULL DEFAULT '[]'::jsonb,
    enabled BOOLEAN NOT NULL DEFAULT true,
    created_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX room_github_bindings_installation_idx
ON room_github_bindings(installation_id);

-- migrate:down
DROP INDEX IF EXISTS room_github_bindings_installation_idx;
DROP TABLE IF EXISTS room_github_bindings;

DROP INDEX IF EXISTS app_github_installations_account_idx;
DROP TABLE IF EXISTS app_github_installations;

DROP TABLE IF EXISTS app_github_apps;

DROP INDEX IF EXISTS app_github_manifest_sessions_expires_at_idx;
DROP TABLE IF EXISTS app_github_manifest_sessions;
