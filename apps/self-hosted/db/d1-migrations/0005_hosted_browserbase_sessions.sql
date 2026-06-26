CREATE TABLE hosted_browserbase_session (
    browserbase_session_id TEXT PRIMARY KEY NOT NULL,
    workspace_id TEXT NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
    room_id TEXT NOT NULL,
    session_key TEXT,
    run_id TEXT,
    job_id TEXT,
    usage_request_id TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('creating', 'active', 'release_requested', 'released')),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    released_at TEXT,
    UNIQUE(workspace_id, room_id, usage_request_id),
    FOREIGN KEY (workspace_id, room_id)
        REFERENCES hosted_room(workspace_id, id)
        ON DELETE CASCADE,
    FOREIGN KEY (workspace_id, room_id, job_id)
        REFERENCES hosted_room_job(workspace_id, room_id, id)
        ON DELETE RESTRICT
);

CREATE INDEX hosted_browserbase_session_room_status_idx
    ON hosted_browserbase_session(workspace_id, room_id, status);
