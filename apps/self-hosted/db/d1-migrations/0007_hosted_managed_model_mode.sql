PRAGMA defer_foreign_keys = ON;

DROP TABLE IF EXISTS hosted_room_config_migrated;

CREATE TABLE hosted_room_config_migrated (
    room_id TEXT PRIMARY KEY NOT NULL,
    workspace_id TEXT NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
    instructions TEXT NOT NULL,
    provider_mode TEXT NOT NULL CHECK (provider_mode IN ('app_default', 'app_connection', 'managed_hosted')),
    provider_connection_id TEXT,
    room_mode TEXT NOT NULL CHECK (room_mode IN ('programmer', 'coworker')),
    capability_overrides TEXT NOT NULL,
    image_provider TEXT CHECK (image_provider IS NULL OR image_provider IN ('openai', 'gemini')),
    image_model TEXT,
    image_secret_id TEXT,
    cron_timezone TEXT NOT NULL,
    browser_action_budget INTEGER NOT NULL CHECK (browser_action_budget > 0),
    created_at DATE NOT NULL,
    updated_at DATE NOT NULL,
    FOREIGN KEY (workspace_id, room_id)
        REFERENCES hosted_room(workspace_id, id)
        ON DELETE CASCADE,
    FOREIGN KEY (workspace_id, provider_connection_id)
        REFERENCES hosted_provider_connection(workspace_id, id)
        ON DELETE RESTRICT,
    FOREIGN KEY (workspace_id, image_secret_id)
        REFERENCES hosted_secret(workspace_id, id)
        ON DELETE RESTRICT
);

INSERT INTO hosted_room_config_migrated (
    room_id,
    workspace_id,
    instructions,
    provider_mode,
    provider_connection_id,
    room_mode,
    capability_overrides,
    image_provider,
    image_model,
    image_secret_id,
    cron_timezone,
    browser_action_budget,
    created_at,
    updated_at
)
SELECT
    config.room_id,
    config.workspace_id,
    config.instructions,
    CASE
        WHEN config.provider_mode = 'app_default'
         AND config.provider_connection_id IS NULL
         AND (
             settings.default_provider_connection_id IS NULL
             OR settings.default_provider_connection_id = ''
         )
            THEN 'managed_hosted'
        ELSE config.provider_mode
    END,
    config.provider_connection_id,
    config.room_mode,
    config.capability_overrides,
    config.image_provider,
    config.image_model,
    config.image_secret_id,
    config.cron_timezone,
    config.browser_action_budget,
    config.created_at,
    config.updated_at
FROM hosted_room_config AS config
LEFT JOIN hosted_workspace_settings AS settings
  ON settings.workspace_id = config.workspace_id;

DROP TABLE hosted_room_config;
ALTER TABLE hosted_room_config_migrated RENAME TO hosted_room_config;

CREATE INDEX hosted_room_config_workspace_id_idx ON hosted_room_config(workspace_id);

PRAGMA defer_foreign_keys = OFF;
