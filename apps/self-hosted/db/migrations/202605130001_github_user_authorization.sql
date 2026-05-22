-- migrate:up
CREATE TABLE app_github_user_auth_sessions (
    state_hash TEXT PRIMARY KEY,
    actor_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    public_origin TEXT NOT NULL,
    code_verifier TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('pending', 'completed', 'expired', 'failed')) DEFAULT 'pending',
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX app_github_user_auth_sessions_expires_at_idx
ON app_github_user_auth_sessions(expires_at);

CREATE TABLE app_github_user_connections (
    id BOOLEAN PRIMARY KEY DEFAULT true CHECK (id),
    github_user_id TEXT NOT NULL,
    login TEXT NOT NULL,
    name TEXT,
    avatar_url TEXT,
    html_url TEXT,
    token_type TEXT NOT NULL DEFAULT 'bearer',
    access_token_secret_id UUID NOT NULL REFERENCES secrets(id) ON DELETE RESTRICT,
    access_token_expires_at TIMESTAMPTZ,
    refresh_token_secret_id UUID REFERENCES secrets(id) ON DELETE SET NULL,
    refresh_token_expires_at TIMESTAMPTZ,
    created_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    last_authorized_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX app_github_user_connections_login_idx
ON app_github_user_connections(login);

-- migrate:down
DROP INDEX IF EXISTS app_github_user_connections_login_idx;
DROP TABLE IF EXISTS app_github_user_connections;

DROP INDEX IF EXISTS app_github_user_auth_sessions_expires_at_idx;
DROP TABLE IF EXISTS app_github_user_auth_sessions;
