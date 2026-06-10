-- migrate:up
ALTER TABLE room_configs
ADD COLUMN room_mode TEXT NOT NULL DEFAULT 'coworker';

UPDATE room_configs
SET room_mode = CASE
    WHEN tools_profile = 'minimal' THEN 'programmer'
    ELSE 'coworker'
END;

UPDATE room_configs
SET capability_overrides = capability_overrides || jsonb_build_object(
    'shell_coding', false,
    'documents', false,
    'spreadsheets', false,
    'presentations', false,
    'pdf', false,
    'images', false
)
WHERE tools_profile = 'read-only';

ALTER TABLE room_configs
ADD CONSTRAINT room_configs_room_mode_check
CHECK (room_mode IN ('programmer', 'coworker'));

ALTER TABLE room_configs
DROP CONSTRAINT IF EXISTS room_configs_tools_profile_check;

ALTER TABLE room_configs
DROP COLUMN tools_profile;

-- migrate:down
ALTER TABLE room_configs
ADD COLUMN tools_profile TEXT NOT NULL DEFAULT 'coding';

UPDATE room_configs
SET tools_profile = CASE
    WHEN room_mode = 'programmer' THEN 'minimal'
    ELSE 'coding'
END;

ALTER TABLE room_configs
ADD CONSTRAINT room_configs_tools_profile_check
CHECK (tools_profile IN ('coding', 'minimal', 'read-only'));

ALTER TABLE room_configs
DROP CONSTRAINT IF EXISTS room_configs_room_mode_check;

ALTER TABLE room_configs
DROP COLUMN room_mode;
