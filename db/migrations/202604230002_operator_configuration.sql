-- migrate:up
CREATE TABLE app_provider_connections (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    label TEXT NOT NULL,
    provider TEXT NOT NULL,
    api TEXT NOT NULL,
    base_url TEXT,
    default_model TEXT NOT NULL,
    fallback_models JSONB NOT NULL DEFAULT '[]'::jsonb,
    credential_secret_id UUID REFERENCES secrets(id) ON DELETE SET NULL,
    status TEXT NOT NULL CHECK (status IN ('unchecked', 'ready', 'invalid')) DEFAULT 'unchecked',
    validation_message TEXT,
    last_validated_at TIMESTAMPTZ,
    created_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX app_provider_connections_provider_idx ON app_provider_connections(provider);

CREATE TABLE app_mcp_connections (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    server_key TEXT NOT NULL UNIQUE,
    transport TEXT NOT NULL CHECK (transport IN ('stdio', 'http', 'streamable_http')),
    command TEXT,
    args JSONB NOT NULL DEFAULT '[]'::jsonb,
    url TEXT,
    headers JSONB NOT NULL DEFAULT '{}'::jsonb,
    auth_mode TEXT NOT NULL CHECK (auth_mode IN ('none', 'bearer')) DEFAULT 'none',
    credential_secret_id UUID REFERENCES secrets(id) ON DELETE SET NULL,
    allowed_tools JSONB NOT NULL DEFAULT '[]'::jsonb,
    status TEXT NOT NULL CHECK (status IN ('unchecked', 'ready', 'invalid')) DEFAULT 'unchecked',
    validation_message TEXT,
    last_validated_at TIMESTAMPTZ,
    created_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (
        (transport = 'stdio' AND command IS NOT NULL AND length(trim(command)) > 0)
        OR (transport IN ('http', 'streamable_http') AND url IS NOT NULL AND length(trim(url)) > 0)
    )
);

CREATE INDEX app_mcp_connections_transport_idx ON app_mcp_connections(transport);

CREATE TABLE app_settings (
    id BOOLEAN PRIMARY KEY DEFAULT true CHECK (id),
    default_provider_connection_id UUID REFERENCES app_provider_connections(id) ON DELETE SET NULL,
    default_model TEXT,
    onboarding_completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO app_settings (id)
VALUES (true)
ON CONFLICT (id) DO NOTHING;

CREATE TABLE room_configs (
    room_id UUID PRIMARY KEY REFERENCES rooms(id) ON DELETE CASCADE,
    instructions TEXT NOT NULL DEFAULT '',
    provider_mode TEXT NOT NULL CHECK (provider_mode IN ('app_default', 'app_connection', 'room_secret')) DEFAULT 'app_default',
    provider_connection_id UUID REFERENCES app_provider_connections(id) ON DELETE SET NULL,
    provider TEXT,
    provider_api TEXT,
    provider_base_url TEXT,
    provider_model TEXT,
    provider_secret_id UUID REFERENCES secrets(id) ON DELETE SET NULL,
    tools_profile TEXT NOT NULL CHECK (tools_profile IN ('coding', 'minimal', 'read-only')) DEFAULT 'coding',
    cron_timezone TEXT NOT NULL DEFAULT 'UTC',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX room_configs_provider_connection_idx ON room_configs(provider_connection_id);

CREATE TABLE room_mcp_bindings (
    room_id UUID NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    mcp_connection_id UUID NOT NULL REFERENCES app_mcp_connections(id) ON DELETE CASCADE,
    allowed_tools JSONB NOT NULL DEFAULT '[]'::jsonb,
    enabled BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (room_id, mcp_connection_id)
);

CREATE INDEX room_mcp_bindings_connection_idx ON room_mcp_bindings(mcp_connection_id);

CREATE TABLE room_secrets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    room_id UUID NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    secret_id UUID NOT NULL REFERENCES secrets(id) ON DELETE CASCADE,
    label TEXT NOT NULL,
    env_key TEXT NOT NULL,
    purpose TEXT NOT NULL CHECK (purpose IN ('provider_api_key', 'generic', 'webhook')),
    provider TEXT,
    created_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (room_id, env_key)
);

CREATE INDEX room_secrets_room_id_idx ON room_secrets(room_id);

-- migrate:down
DROP INDEX IF EXISTS room_secrets_room_id_idx;
DROP TABLE IF EXISTS room_secrets;

DROP INDEX IF EXISTS room_mcp_bindings_connection_idx;
DROP TABLE IF EXISTS room_mcp_bindings;

DROP INDEX IF EXISTS room_configs_provider_connection_idx;
DROP TABLE IF EXISTS room_configs;

DROP TABLE IF EXISTS app_settings;

DROP INDEX IF EXISTS app_mcp_connections_transport_idx;
DROP TABLE IF EXISTS app_mcp_connections;

DROP INDEX IF EXISTS app_provider_connections_provider_idx;
DROP TABLE IF EXISTS app_provider_connections;
