-- migrate:up
DROP TABLE IF EXISTS room_subagent_runs;
DROP TABLE IF EXISTS room_runtime_events;
DROP TABLE IF EXISTS room_threads;

-- migrate:down
