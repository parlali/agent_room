-- migrate:up
UPDATE room_configs
SET tools_profile = 'coding'
WHERE tools_profile NOT IN ('coding', 'minimal', 'read-only');

ALTER TABLE room_configs
DROP CONSTRAINT IF EXISTS room_configs_tools_profile_check;

ALTER TABLE room_configs
ADD CONSTRAINT room_configs_tools_profile_check
CHECK (tools_profile IN ('coding', 'minimal', 'read-only'));

-- migrate:down
ALTER TABLE room_configs
DROP CONSTRAINT IF EXISTS room_configs_tools_profile_check;
