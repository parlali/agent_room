-- migrate:up
ALTER TABLE room_runtime_metadata
ADD COLUMN sandbox_uid INTEGER,
ADD COLUMN sandbox_gid INTEGER,
ADD COLUMN sandbox_user_name TEXT,
ADD COLUMN sandbox_group_name TEXT;

-- migrate:down
ALTER TABLE room_runtime_metadata
DROP COLUMN IF EXISTS sandbox_group_name,
DROP COLUMN IF EXISTS sandbox_user_name,
DROP COLUMN IF EXISTS sandbox_gid,
DROP COLUMN IF EXISTS sandbox_uid;
