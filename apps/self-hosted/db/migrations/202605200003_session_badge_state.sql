-- migrate:up
ALTER TABLE IF EXISTS room_thread_read_state RENAME TO room_session_badge_state;
ALTER TABLE IF EXISTS room_session_badge_state RENAME COLUMN read_at TO completed_cleared_at;
ALTER INDEX IF EXISTS room_thread_read_state_room_user_idx
    RENAME TO room_session_badge_state_room_user_idx;

-- migrate:down
ALTER INDEX IF EXISTS room_session_badge_state_room_user_idx
    RENAME TO room_thread_read_state_room_user_idx;
ALTER TABLE IF EXISTS room_session_badge_state RENAME COLUMN completed_cleared_at TO read_at;
ALTER TABLE IF EXISTS room_session_badge_state RENAME TO room_thread_read_state;
