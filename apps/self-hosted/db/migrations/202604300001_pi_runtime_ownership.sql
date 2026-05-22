-- migrate:up
ALTER TABLE app_provider_connections
DROP CONSTRAINT IF EXISTS app_provider_connections_auth_secret_check;

DROP INDEX IF EXISTS room_entitlements_kind_idx;
DROP INDEX IF EXISTS room_entitlements_room_id_idx;
DROP TABLE IF EXISTS room_entitlements;

UPDATE room_configs
SET tools_profile = 'coding'
WHERE tools_profile NOT IN ('coding', 'minimal', 'read-only');

ALTER TABLE room_configs
DROP CONSTRAINT IF EXISTS room_configs_tools_profile_check;

ALTER TABLE room_configs
ADD CONSTRAINT room_configs_tools_profile_check
CHECK (tools_profile IN ('coding', 'minimal', 'read-only'));

ALTER TABLE app_provider_connections
ADD CONSTRAINT app_provider_connections_auth_secret_check
CHECK (
    auth_mode = 'oauth'
    OR credential_secret_id IS NOT NULL
    OR provider IN ('ollama', 'lmstudio')
);

CREATE TABLE provider_validation_attempts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    provider_connection_id UUID REFERENCES app_provider_connections(id) ON DELETE SET NULL,
    room_id UUID REFERENCES rooms(id) ON DELETE SET NULL,
    provider TEXT NOT NULL,
    auth_mode TEXT NOT NULL CHECK (auth_mode IN ('api_key', 'oauth')),
    api TEXT NOT NULL,
    base_url TEXT,
    model TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('unchecked', 'ready', 'invalid')),
    message TEXT NOT NULL,
    started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX provider_validation_attempts_provider_idx ON provider_validation_attempts(provider, completed_at DESC);

CREATE TABLE room_cron_jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    room_id UUID NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    message TEXT NOT NULL,
    enabled BOOLEAN NOT NULL DEFAULT true,
    every_minutes INTEGER NOT NULL CHECK (every_minutes > 0),
    timezone TEXT NOT NULL DEFAULT 'UTC',
    session_target TEXT NOT NULL DEFAULT 'isolated' CHECK (session_target IN ('isolated', 'selected')),
    target_thread_key TEXT,
    next_run_at TIMESTAMPTZ,
    running_at TIMESTAMPTZ,
    locked_until TIMESTAMPTZ,
    lock_token TEXT,
    last_run_at TIMESTAMPTZ,
    last_run_status TEXT,
    last_error TEXT,
    last_duration_ms INTEGER,
    provider TEXT,
    model TEXT,
    config_version INTEGER,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX room_cron_jobs_room_id_idx ON room_cron_jobs(room_id);
CREATE INDEX room_cron_jobs_due_idx ON room_cron_jobs(enabled, next_run_at) WHERE enabled = true;

CREATE TABLE room_cron_runs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    room_id UUID NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    job_id UUID REFERENCES room_cron_jobs(id) ON DELETE SET NULL,
    job_name TEXT,
    attempt INTEGER NOT NULL DEFAULT 1 CHECK (attempt > 0),
    status TEXT NOT NULL CHECK (status IN ('running', 'complete', 'failed', 'skipped')),
    summary TEXT,
    error TEXT,
    session_key TEXT,
    session_id TEXT,
    provider TEXT,
    model TEXT,
    config_version INTEGER,
    started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    finished_at TIMESTAMPTZ,
    duration_ms INTEGER,
    next_run_at TIMESTAMPTZ
);

CREATE INDEX room_cron_runs_room_id_started_at_idx ON room_cron_runs(room_id, started_at DESC);
CREATE INDEX room_cron_runs_job_id_started_at_idx ON room_cron_runs(job_id, started_at DESC);

-- migrate:down
DROP INDEX IF EXISTS room_cron_runs_job_id_started_at_idx;
DROP INDEX IF EXISTS room_cron_runs_room_id_started_at_idx;
DROP TABLE IF EXISTS room_cron_runs;

DROP INDEX IF EXISTS room_cron_jobs_due_idx;
DROP INDEX IF EXISTS room_cron_jobs_room_id_idx;
DROP TABLE IF EXISTS room_cron_jobs;

DROP INDEX IF EXISTS provider_validation_attempts_provider_idx;
DROP TABLE IF EXISTS provider_validation_attempts;

ALTER TABLE room_configs
DROP CONSTRAINT IF EXISTS room_configs_tools_profile_check;

ALTER TABLE app_provider_connections
DROP CONSTRAINT IF EXISTS app_provider_connections_auth_secret_check;

ALTER TABLE app_provider_connections
ADD CONSTRAINT app_provider_connections_auth_secret_check
CHECK (
    (auth_mode = 'api_key' AND credential_secret_id IS NOT NULL)
    OR (auth_mode = 'oauth')
);
