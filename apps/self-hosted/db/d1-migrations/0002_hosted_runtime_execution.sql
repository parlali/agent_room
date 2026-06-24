PRAGMA foreign_keys = ON;

ALTER TABLE hosted_room_runtime_state ADD COLUMN token_object_key TEXT;
ALTER TABLE hosted_room_runtime_state ADD COLUMN runtime_bundle_object_key TEXT;
ALTER TABLE hosted_room_runtime_state ADD COLUMN provider_candidate TEXT CHECK (provider_candidate IS NULL OR provider_candidate IN ('user_key', 'codex', 'hosted_openrouter'));
ALTER TABLE hosted_room_runtime_state ADD COLUMN managed_brave_search_enabled INTEGER NOT NULL DEFAULT 0 CHECK (managed_brave_search_enabled IN (0, 1));

ALTER TABLE hosted_usage_event ADD COLUMN reasoning_tokens INTEGER;
ALTER TABLE hosted_usage_event ADD COLUMN total_tokens INTEGER;
ALTER TABLE hosted_usage_event ADD COLUMN duration_ms INTEGER;
ALTER TABLE hosted_usage_event ADD COLUMN active_duration_ms INTEGER;
ALTER TABLE hosted_usage_event ADD COLUMN idle_duration_ms INTEGER;
ALTER TABLE hosted_usage_event ADD COLUMN estimated_cost_usd TEXT;
ALTER TABLE hosted_usage_event ADD COLUMN metadata TEXT NOT NULL DEFAULT '{}';
ALTER TABLE hosted_usage_event ADD COLUMN idempotency_key TEXT;
ALTER TABLE hosted_room_job ADD COLUMN heartbeat_at DATE;
ALTER TABLE hosted_room_job ADD COLUMN last_renewed_at DATE;
ALTER TABLE hosted_room_job ADD COLUMN run_budget_ms INTEGER;
ALTER TABLE hosted_room_job ADD COLUMN recovery_reason TEXT;
ALTER TABLE hosted_room_job ADD COLUMN last_duration_ms INTEGER;
ALTER TABLE hosted_room_job ADD COLUMN provider TEXT;
ALTER TABLE hosted_room_job ADD COLUMN model TEXT;
ALTER TABLE hosted_room_job ADD COLUMN config_version INTEGER;

CREATE UNIQUE INDEX hosted_usage_event_workspace_id_idempotency_key_idx ON hosted_usage_event(workspace_id, idempotency_key) WHERE idempotency_key IS NOT NULL;

CREATE TABLE hosted_room_job_run (
    id TEXT PRIMARY KEY NOT NULL,
    workspace_id TEXT NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
    room_id TEXT NOT NULL,
    job_id TEXT,
    job_name TEXT,
    attempt INTEGER NOT NULL DEFAULT 1 CHECK (attempt > 0),
    status TEXT NOT NULL CHECK (status IN ('running', 'complete', 'failed', 'skipped')),
    summary TEXT,
    error TEXT,
    lock_token TEXT,
    session_key TEXT,
    session_id TEXT,
    provider TEXT,
    model TEXT,
    config_version INTEGER,
    started_at DATE NOT NULL,
    finished_at DATE,
    duration_ms INTEGER,
    next_run_at DATE,
    FOREIGN KEY (workspace_id, room_id)
        REFERENCES hosted_room(workspace_id, id)
        ON DELETE CASCADE,
    FOREIGN KEY (workspace_id, job_id)
        REFERENCES hosted_room_job(workspace_id, id)
        ON DELETE RESTRICT,
    FOREIGN KEY (workspace_id, room_id, job_id)
        REFERENCES hosted_room_job(workspace_id, room_id, id)
        ON DELETE RESTRICT
);

CREATE INDEX hosted_room_job_run_room_started_idx ON hosted_room_job_run(workspace_id, room_id, started_at);
CREATE INDEX hosted_room_job_run_job_started_idx ON hosted_room_job_run(job_id, started_at);

CREATE TRIGGER hosted_room_job_delete_clear_job_run_job_id
BEFORE DELETE ON hosted_room_job
BEGIN
    UPDATE hosted_room_job_run
    SET job_id = NULL
    WHERE workspace_id = OLD.workspace_id
      AND job_id = OLD.id;
END;

CREATE TABLE hosted_secret (
    id TEXT PRIMARY KEY NOT NULL,
    workspace_id TEXT NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
    key_name TEXT NOT NULL,
    cipher_text TEXT NOT NULL,
    nonce TEXT NOT NULL,
    auth_tag TEXT NOT NULL,
    key_version INTEGER NOT NULL DEFAULT 1,
    created_at DATE NOT NULL,
    updated_at DATE NOT NULL,
    UNIQUE(workspace_id, id),
    UNIQUE(workspace_id, key_name)
);

CREATE INDEX hosted_secret_workspace_id_idx ON hosted_secret(workspace_id);

CREATE TABLE hosted_workspace_settings (
    workspace_id TEXT PRIMARY KEY NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
    default_provider_connection_id TEXT,
    default_model TEXT,
    capability_defaults TEXT NOT NULL,
    search_config TEXT NOT NULL,
    image_config TEXT NOT NULL,
    onboarding_completed_at DATE,
    created_at DATE NOT NULL,
    updated_at DATE NOT NULL,
    FOREIGN KEY (workspace_id, default_provider_connection_id)
        REFERENCES hosted_provider_connection(workspace_id, id)
        ON DELETE RESTRICT
);

CREATE TABLE hosted_room_config (
    room_id TEXT PRIMARY KEY NOT NULL,
    workspace_id TEXT NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
    instructions TEXT NOT NULL,
    provider_mode TEXT NOT NULL CHECK (provider_mode IN ('app_default', 'app_connection')),
    provider_connection_id TEXT,
    room_mode TEXT NOT NULL CHECK (room_mode IN ('programmer', 'coworker')),
    capability_overrides TEXT NOT NULL,
    image_provider TEXT CHECK (image_provider IS NULL OR image_provider IN ('openai', 'gemini')),
    image_model TEXT,
    image_secret_id TEXT,
    cron_timezone TEXT NOT NULL,
    browser_action_budget INTEGER NOT NULL CHECK (browser_action_budget > 0),
    created_at DATE NOT NULL,
    updated_at DATE NOT NULL,
    FOREIGN KEY (workspace_id, room_id)
        REFERENCES hosted_room(workspace_id, id)
        ON DELETE CASCADE,
    FOREIGN KEY (workspace_id, provider_connection_id)
        REFERENCES hosted_provider_connection(workspace_id, id)
        ON DELETE RESTRICT,
    FOREIGN KEY (workspace_id, image_secret_id)
        REFERENCES hosted_secret(workspace_id, id)
        ON DELETE RESTRICT
);

CREATE INDEX hosted_room_config_workspace_id_idx ON hosted_room_config(workspace_id);

CREATE TABLE hosted_room_mcp_binding (
    workspace_id TEXT NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
    room_id TEXT NOT NULL,
    mcp_connection_id TEXT NOT NULL,
    allowed_tools TEXT NOT NULL,
    enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
    created_at DATE NOT NULL,
    updated_at DATE NOT NULL,
    PRIMARY KEY(room_id, mcp_connection_id),
    FOREIGN KEY (workspace_id, room_id)
        REFERENCES hosted_room(workspace_id, id)
        ON DELETE CASCADE,
    FOREIGN KEY (workspace_id, mcp_connection_id)
        REFERENCES hosted_mcp_connection(workspace_id, id)
        ON DELETE CASCADE
);

CREATE INDEX hosted_room_mcp_binding_workspace_id_idx ON hosted_room_mcp_binding(workspace_id);

CREATE TABLE hosted_room_secret (
    id TEXT PRIMARY KEY NOT NULL,
    workspace_id TEXT NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
    room_id TEXT NOT NULL,
    secret_id TEXT NOT NULL,
    label TEXT NOT NULL,
    env_key TEXT NOT NULL,
    purpose TEXT NOT NULL CHECK (purpose IN ('generic', 'webhook', 'image_api_key')),
    provider TEXT,
    created_by_user_id TEXT REFERENCES "user"(id) ON DELETE SET NULL,
    created_at DATE NOT NULL,
    updated_at DATE NOT NULL,
    UNIQUE(workspace_id, room_id, env_key),
    FOREIGN KEY (workspace_id, room_id)
        REFERENCES hosted_room(workspace_id, id)
        ON DELETE CASCADE,
    FOREIGN KEY (workspace_id, secret_id)
        REFERENCES hosted_secret(workspace_id, id)
        ON DELETE CASCADE
);

CREATE INDEX hosted_room_secret_room_idx ON hosted_room_secret(workspace_id, room_id);

CREATE TABLE hosted_room_onboarding (
    room_id TEXT PRIMARY KEY NOT NULL,
    workspace_id TEXT NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
    status TEXT NOT NULL CHECK (status IN ('pending', 'completed', 'user_deferred')),
    session_key TEXT,
    created_at DATE NOT NULL,
    updated_at DATE NOT NULL,
    completed_at DATE,
    deferred_at DATE,
    FOREIGN KEY (workspace_id, room_id)
        REFERENCES hosted_room(workspace_id, id)
        ON DELETE CASCADE
);

CREATE TABLE hosted_session_composer_draft (
    workspace_id TEXT NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
    auth_session_id TEXT NOT NULL,
    room_id TEXT NOT NULL,
    session_key TEXT NOT NULL,
    draft TEXT NOT NULL,
    created_at DATE NOT NULL,
    updated_at DATE NOT NULL,
    PRIMARY KEY(workspace_id, auth_session_id, room_id, session_key),
    FOREIGN KEY (workspace_id, room_id)
        REFERENCES hosted_room(workspace_id, id)
        ON DELETE CASCADE
);

CREATE TABLE hosted_room_session_badge (
    workspace_id TEXT NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
    room_id TEXT NOT NULL,
    session_key TEXT NOT NULL,
    completed_cleared_at DATE NOT NULL,
    PRIMARY KEY(workspace_id, user_id, room_id, session_key),
    FOREIGN KEY (workspace_id, room_id)
        REFERENCES hosted_room(workspace_id, id)
        ON DELETE CASCADE
);

CREATE TABLE hosted_room_file_index (
    workspace_id TEXT NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
    room_id TEXT NOT NULL,
    surface TEXT NOT NULL CHECK (surface IN ('workspace', 'store')),
    relative_path TEXT NOT NULL,
    object_key TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('file', 'directory')),
    byte_length INTEGER,
    media_type TEXT,
    created_at DATE NOT NULL,
    updated_at DATE NOT NULL,
    PRIMARY KEY(workspace_id, room_id, surface, relative_path),
    FOREIGN KEY (workspace_id, room_id)
        REFERENCES hosted_room(workspace_id, id)
        ON DELETE CASCADE
);

CREATE INDEX hosted_room_file_index_room_idx ON hosted_room_file_index(workspace_id, room_id);

INSERT INTO hosted_room_config (
    room_id,
    workspace_id,
    instructions,
    provider_mode,
    provider_connection_id,
    room_mode,
    capability_overrides,
    image_provider,
    image_model,
    image_secret_id,
    cron_timezone,
    browser_action_budget,
    created_at,
    updated_at
)
SELECT
    id,
    workspace_id,
    '',
    'app_default',
    NULL,
    'coworker',
    '{}',
    NULL,
    NULL,
    NULL,
    'UTC',
    50,
    created_at,
    updated_at
FROM hosted_room
WHERE NOT EXISTS (
    SELECT 1
    FROM hosted_room_config
    WHERE hosted_room_config.workspace_id = hosted_room.workspace_id
      AND hosted_room_config.room_id = hosted_room.id
);

INSERT INTO hosted_room_onboarding (
    room_id,
    workspace_id,
    status,
    session_key,
    created_at,
    updated_at,
    completed_at,
    deferred_at
)
SELECT
    id,
    workspace_id,
    'completed',
    NULL,
    created_at,
    updated_at,
    updated_at,
    NULL
FROM hosted_room
WHERE NOT EXISTS (
    SELECT 1
    FROM hosted_room_onboarding
    WHERE hosted_room_onboarding.workspace_id = hosted_room.workspace_id
      AND hosted_room_onboarding.room_id = hosted_room.id
);

CREATE TABLE hosted_audit_event (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    workspace_id TEXT NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
    actor_user_id TEXT REFERENCES "user"(id) ON DELETE SET NULL,
    room_id TEXT,
    action TEXT NOT NULL,
    payload TEXT NOT NULL,
    created_at DATE NOT NULL
);

CREATE INDEX hosted_audit_event_workspace_created_idx ON hosted_audit_event(workspace_id, created_at);
