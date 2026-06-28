PRAGMA foreign_keys = ON;

CREATE TABLE hosted_room_cron_job (
    id TEXT PRIMARY KEY NOT NULL,
    workspace_id TEXT NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
    room_id TEXT NOT NULL,
    name TEXT NOT NULL,
    message TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
    every_minutes INTEGER NOT NULL CHECK (every_minutes > 0),
    schedule TEXT NOT NULL,
    timezone TEXT NOT NULL DEFAULT 'UTC',
    next_run_at TEXT,
    running_at TEXT,
    locked_until TEXT,
    lock_token TEXT,
    heartbeat_at TEXT,
    last_renewed_at TEXT,
    run_budget_ms INTEGER,
    last_run_at TEXT,
    last_run_status TEXT,
    last_error TEXT,
    last_duration_ms INTEGER,
    provider TEXT,
    model TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (workspace_id, room_id)
        REFERENCES hosted_room(workspace_id, id)
        ON DELETE CASCADE
);

CREATE INDEX hosted_room_cron_job_room_idx
    ON hosted_room_cron_job(workspace_id, room_id);

CREATE INDEX hosted_room_cron_job_due_idx
    ON hosted_room_cron_job(enabled, next_run_at);

CREATE TABLE hosted_room_cron_run (
    id TEXT PRIMARY KEY NOT NULL,
    workspace_id TEXT NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
    room_id TEXT NOT NULL,
    job_id TEXT,
    job_name TEXT,
    status TEXT NOT NULL CHECK (status IN ('running', 'complete', 'failed', 'skipped')),
    summary TEXT,
    error TEXT,
    session_key TEXT,
    provider TEXT,
    model TEXT,
    started_at TEXT NOT NULL,
    finished_at TEXT,
    duration_ms INTEGER,
    next_run_at TEXT,
    FOREIGN KEY (workspace_id, room_id)
        REFERENCES hosted_room(workspace_id, id)
        ON DELETE CASCADE
);

CREATE INDEX hosted_room_cron_run_room_idx
    ON hosted_room_cron_run(workspace_id, room_id, started_at);
