-- migrate:up
CREATE TABLE room_thread_read_state (
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    room_id UUID NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    session_key TEXT NOT NULL,
    read_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, room_id, session_key)
);

CREATE INDEX room_thread_read_state_room_user_idx
    ON room_thread_read_state(room_id, user_id);

-- migrate:down
DROP INDEX IF EXISTS room_thread_read_state_room_user_idx;
DROP TABLE IF EXISTS room_thread_read_state;
