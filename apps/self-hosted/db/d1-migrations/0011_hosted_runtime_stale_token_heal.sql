PRAGMA foreign_keys = ON;

ALTER TABLE hosted_room_runtime_state ADD COLUMN previous_token_hash TEXT;
ALTER TABLE hosted_room_runtime_state ADD COLUMN stale_token_heal_enqueued_at DATE;
