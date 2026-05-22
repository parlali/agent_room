-- migrate:up
ALTER TABLE app_settings
ADD COLUMN IF NOT EXISTS capability_defaults JSONB NOT NULL DEFAULT '{}'::jsonb,
ADD COLUMN IF NOT EXISTS search_config JSONB NOT NULL DEFAULT '{}'::jsonb,
ADD COLUMN IF NOT EXISTS image_config JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE room_configs
ADD COLUMN IF NOT EXISTS capability_overrides JSONB NOT NULL DEFAULT '{}'::jsonb,
ADD COLUMN IF NOT EXISTS image_provider TEXT CHECK (image_provider IS NULL OR image_provider IN ('openai', 'gemini')),
ADD COLUMN IF NOT EXISTS image_model TEXT,
ADD COLUMN IF NOT EXISTS image_secret_id UUID REFERENCES secrets(id) ON DELETE SET NULL;

ALTER TABLE room_cron_jobs
ADD COLUMN IF NOT EXISTS heartbeat_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS last_renewed_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS run_budget_ms INTEGER,
ADD COLUMN IF NOT EXISTS recovery_reason TEXT;

CREATE TABLE IF NOT EXISTS usage_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    room_id UUID REFERENCES rooms(id) ON DELETE CASCADE,
    session_key TEXT,
    run_id TEXT,
    job_id UUID REFERENCES room_cron_jobs(id) ON DELETE SET NULL,
    kind TEXT NOT NULL CHECK (kind IN ('run', 'provider', 'tool', 'document_worker', 'image', 'job')),
    provider TEXT,
    model TEXT,
    tool_name TEXT,
    input_tokens BIGINT,
    output_tokens BIGINT,
    cached_tokens BIGINT,
    reasoning_tokens BIGINT,
    total_tokens BIGINT,
    duration_ms INTEGER,
    active_duration_ms INTEGER,
    idle_duration_ms INTEGER,
    estimated_cost_usd NUMERIC(18, 8),
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS usage_events_room_created_idx ON usage_events(room_id, created_at DESC);
CREATE INDEX IF NOT EXISTS usage_events_kind_created_idx ON usage_events(kind, created_at DESC);
CREATE INDEX IF NOT EXISTS usage_events_session_run_idx ON usage_events(room_id, session_key, run_id);

-- migrate:down
DROP INDEX IF EXISTS usage_events_session_run_idx;
DROP INDEX IF EXISTS usage_events_kind_created_idx;
DROP INDEX IF EXISTS usage_events_room_created_idx;
DROP TABLE IF EXISTS usage_events;

ALTER TABLE room_cron_jobs
DROP COLUMN IF EXISTS recovery_reason,
DROP COLUMN IF EXISTS run_budget_ms,
DROP COLUMN IF EXISTS last_renewed_at,
DROP COLUMN IF EXISTS heartbeat_at;

ALTER TABLE room_configs
DROP COLUMN IF EXISTS image_secret_id,
DROP COLUMN IF EXISTS image_model,
DROP COLUMN IF EXISTS image_provider,
DROP COLUMN IF EXISTS capability_overrides;

ALTER TABLE app_settings
DROP COLUMN IF EXISTS image_config,
DROP COLUMN IF EXISTS search_config,
DROP COLUMN IF EXISTS capability_defaults;
