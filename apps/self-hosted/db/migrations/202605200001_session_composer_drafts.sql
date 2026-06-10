-- migrate:up
CREATE TABLE session_composer_drafts (
    auth_session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    room_id UUID NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    session_key TEXT NOT NULL,
    draft TEXT NOT NULL CHECK (char_length(draft) <= 20000),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (auth_session_id, room_id, session_key)
);

CREATE INDEX session_composer_drafts_room_session_idx
    ON session_composer_drafts(room_id, session_key);

-- migrate:down
DROP INDEX IF EXISTS session_composer_drafts_room_session_idx;
DROP TABLE IF EXISTS session_composer_drafts;
