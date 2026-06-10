-- migrate:up
ALTER TABLE room_configs
ADD COLUMN IF NOT EXISTS browser_action_budget INTEGER NOT NULL DEFAULT 50
CHECK (browser_action_budget BETWEEN 1 AND 200);

-- migrate:down
ALTER TABLE room_configs
DROP COLUMN IF EXISTS browser_action_budget;
