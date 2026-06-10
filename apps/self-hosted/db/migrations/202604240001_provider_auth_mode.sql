-- migrate:up
ALTER TABLE app_provider_connections
ADD COLUMN auth_mode TEXT NOT NULL DEFAULT 'api_key'
CHECK (auth_mode IN ('api_key', 'oauth'));

UPDATE app_provider_connections
SET auth_mode = 'oauth'
WHERE provider = 'openai-codex' OR api = 'openai-codex-responses';

ALTER TABLE app_provider_connections
ADD CONSTRAINT app_provider_connections_auth_secret_check
CHECK (
    (auth_mode = 'api_key' AND credential_secret_id IS NOT NULL)
    OR (auth_mode = 'oauth')
);

-- migrate:down
ALTER TABLE app_provider_connections
DROP CONSTRAINT IF EXISTS app_provider_connections_auth_secret_check;

ALTER TABLE app_provider_connections
DROP COLUMN IF EXISTS auth_mode;
