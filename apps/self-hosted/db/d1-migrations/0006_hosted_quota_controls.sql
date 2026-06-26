PRAGMA foreign_keys = ON;

CREATE TABLE hosted_quota_policy (
    workspace_id TEXT PRIMARY KEY NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
    status TEXT NOT NULL CHECK (status IN ('active', 'restricted', 'suspended')) DEFAULT 'active',
    limits TEXT NOT NULL DEFAULT '{}',
    restrictions TEXT NOT NULL DEFAULT '{}',
    note TEXT,
    updated_by_user_id TEXT REFERENCES "user"(id) ON DELETE SET NULL,
    created_at DATE NOT NULL,
    updated_at DATE NOT NULL
);

CREATE TABLE hosted_quota_counter (
    scope TEXT NOT NULL CHECK (scope IN ('workspace', 'user', 'ip', 'room', 'session', 'job', 'runtime', 'provider')),
    scope_id TEXT NOT NULL,
    window_key TEXT NOT NULL,
    counter_key TEXT NOT NULL,
    quantity INTEGER NOT NULL DEFAULT 0 CHECK (quantity >= 0),
    updated_at DATE NOT NULL,
    PRIMARY KEY(scope, scope_id, window_key, counter_key)
);

CREATE INDEX hosted_quota_counter_scope_window_idx
    ON hosted_quota_counter(scope, window_key, counter_key);

CREATE TABLE hosted_quota_event (
    id TEXT PRIMARY KEY NOT NULL,
    workspace_id TEXT REFERENCES organization(id) ON DELETE CASCADE,
    actor_user_id TEXT REFERENCES "user"(id) ON DELETE SET NULL,
    room_id TEXT,
    scope TEXT NOT NULL CHECK (scope IN ('workspace', 'user', 'ip', 'room', 'session', 'job', 'runtime', 'provider')),
    scope_hash TEXT NOT NULL,
    action TEXT NOT NULL CHECK (action IN ('runtime_start', 'run_start', 'provider_openrouter', 'provider_brave', 'provider_browserbase', 'provider_fetch_url', 'browserbase_session_start', 'file_upload', 'runtime_file_sync', 'runtime_state_sync', 'scheduled_job_claim', 'shell_command', 'document_worker', 'image_generation')),
    decision TEXT NOT NULL CHECK (decision IN ('allowed', 'denied')),
    reason TEXT,
    quantity INTEGER,
    metadata TEXT NOT NULL DEFAULT '{}',
    created_at DATE NOT NULL
);

CREATE INDEX hosted_quota_event_workspace_created_idx
    ON hosted_quota_event(workspace_id, created_at);
CREATE INDEX hosted_quota_event_scope_created_idx
    ON hosted_quota_event(scope, scope_hash, created_at);
