CREATE TABLE IF NOT EXISTS waitlist_submissions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at TEXT NOT NULL,
    source_ip TEXT NOT NULL,
    name TEXT NOT NULL,
    email TEXT NOT NULL,
    company TEXT NOT NULL,
    use_case TEXT NOT NULL,
    interest TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS waitlist_submissions_email_idx
    ON waitlist_submissions (email);

CREATE INDEX IF NOT EXISTS waitlist_submissions_created_at_idx
    ON waitlist_submissions (created_at);

CREATE TABLE IF NOT EXISTS waitlist_rate_limits (
    key TEXT PRIMARY KEY,
    count INTEGER NOT NULL,
    reset_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS waitlist_rate_limits_reset_at_idx
    ON waitlist_rate_limits (reset_at);
