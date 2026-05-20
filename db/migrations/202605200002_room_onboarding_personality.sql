-- migrate:up
ALTER TABLE rooms DROP CONSTRAINT IF EXISTS rooms_status_check;
ALTER TABLE rooms ADD CONSTRAINT rooms_status_check
    CHECK (status IN ('starting', 'running', 'stopped', 'degraded', 'failed', 'setup_required'));

CREATE TABLE room_onboarding (
    room_id UUID PRIMARY KEY REFERENCES rooms(id) ON DELETE CASCADE,
    status TEXT NOT NULL CHECK (status IN ('pending', 'completed', 'user_deferred')),
    session_key TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at TIMESTAMPTZ,
    deferred_at TIMESTAMPTZ
);

CREATE INDEX room_onboarding_status_idx ON room_onboarding(status);

INSERT INTO room_onboarding (room_id, status, deferred_at)
SELECT id, 'user_deferred', now()
FROM rooms
ON CONFLICT (room_id) DO NOTHING;

-- migrate:down
DROP INDEX IF EXISTS room_onboarding_status_idx;
DROP TABLE IF EXISTS room_onboarding;

ALTER TABLE rooms DROP CONSTRAINT IF EXISTS rooms_status_check;
ALTER TABLE rooms ADD CONSTRAINT rooms_status_check
    CHECK (status IN ('starting', 'running', 'stopped', 'degraded', 'failed'));
