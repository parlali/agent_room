-- migrate:up
CREATE TEMP TABLE removed_room_provider_secret_ids (
    id UUID PRIMARY KEY
) ON COMMIT DROP;

CREATE TEMP TABLE removed_model_provider_secret_ids (
    id UUID PRIMARY KEY
) ON COMMIT DROP;

DROP TABLE IF EXISTS migration_202606110001_room_configs_backup;
DROP TABLE IF EXISTS migration_202606110001_room_secrets_backup;
DROP TABLE IF EXISTS migration_202606110001_app_provider_connections_backup;
DROP TABLE IF EXISTS migration_202606110001_app_settings_backup;
DROP TABLE IF EXISTS migration_202606110001_secrets_backup;

CREATE TABLE migration_202606110001_room_configs_backup AS
SELECT
    room_id,
    provider_mode,
    provider_connection_id,
    provider,
    provider_api,
    provider_base_url,
    provider_model,
    provider_secret_id,
    updated_at
FROM room_configs;

CREATE TABLE migration_202606110001_room_secrets_backup AS
SELECT *
FROM room_secrets;

CREATE TABLE migration_202606110001_app_provider_connections_backup AS
SELECT *
FROM app_provider_connections;

CREATE TABLE migration_202606110001_app_settings_backup AS
SELECT *
FROM app_settings;

CREATE TABLE migration_202606110001_secrets_backup AS
SELECT *
FROM secrets
WHERE id IN (
    SELECT provider_secret_id
    FROM room_configs
    WHERE provider_secret_id IS NOT NULL
    UNION
    SELECT secret_id
    FROM room_secrets
    WHERE purpose = 'provider_api_key'
    UNION
    SELECT credential_secret_id
    FROM app_provider_connections
    WHERE credential_secret_id IS NOT NULL
);

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE
            table_schema = 'public'
            AND table_name = 'room_configs'
            AND column_name = 'provider_secret_id'
    ) THEN
        EXECUTE '
            INSERT INTO removed_room_provider_secret_ids (id)
            SELECT provider_secret_id
            FROM room_configs
            WHERE provider_secret_id IS NOT NULL
            ON CONFLICT DO NOTHING
        ';
    END IF;
END $$;

DELETE FROM room_secrets
WHERE secret_id IN (
    SELECT id
    FROM removed_room_provider_secret_ids
);

UPDATE room_secrets
SET
    purpose = 'image_api_key',
    updated_at = now()
WHERE
    purpose = 'provider_api_key'
    AND upper(env_key) IN (
        'AGENT_ROOM_IMAGE_OPENAI_API_KEY',
        'AGENT_ROOM_IMAGE_GEMINI_API_KEY'
    );

WITH removed_room_provider_secret_records AS (
    DELETE FROM room_secrets
    WHERE purpose = 'provider_api_key'
    RETURNING secret_id
)
INSERT INTO removed_model_provider_secret_ids (id)
SELECT secret_id
FROM removed_room_provider_secret_records
WHERE secret_id IS NOT NULL
ON CONFLICT DO NOTHING;

INSERT INTO removed_model_provider_secret_ids (id)
SELECT id
FROM removed_room_provider_secret_ids
ON CONFLICT DO NOTHING;

WITH removed_provider_connections AS (
    DELETE FROM app_provider_connections
    WHERE provider NOT IN ('openrouter', 'openai-codex')
    RETURNING credential_secret_id
)
INSERT INTO removed_model_provider_secret_ids (id)
SELECT credential_secret_id
FROM removed_provider_connections
WHERE credential_secret_id IS NOT NULL
ON CONFLICT DO NOTHING;

INSERT INTO removed_model_provider_secret_ids (id)
SELECT credential_secret_id
FROM app_provider_connections
WHERE
    provider = 'openai-codex'
    AND credential_secret_id IS NOT NULL
ON CONFLICT DO NOTHING;

UPDATE room_configs
SET
    provider_mode = 'app_default',
    provider_connection_id = NULL,
    updated_at = now()
WHERE provider_mode = 'room_secret';

ALTER TABLE room_configs
DROP CONSTRAINT IF EXISTS room_configs_provider_mode_check;

ALTER TABLE room_configs
ADD CONSTRAINT room_configs_provider_mode_check
CHECK (provider_mode IN ('app_default', 'app_connection'));

ALTER TABLE room_secrets
DROP CONSTRAINT IF EXISTS room_secrets_purpose_check;

ALTER TABLE room_secrets
ADD CONSTRAINT room_secrets_purpose_check
CHECK (purpose IN ('generic', 'webhook', 'image_api_key'));

ALTER TABLE room_configs
DROP COLUMN IF EXISTS provider,
DROP COLUMN IF EXISTS provider_api,
DROP COLUMN IF EXISTS provider_base_url,
DROP COLUMN IF EXISTS provider_model,
DROP COLUMN IF EXISTS provider_secret_id;

WITH ranked_provider_connections AS (
    SELECT
        id,
        provider,
        first_value(id) OVER (
            PARTITION BY provider
            ORDER BY updated_at DESC, created_at DESC, id DESC
        ) AS keeper_id,
        row_number() OVER (
            PARTITION BY provider
            ORDER BY updated_at DESC, created_at DESC, id DESC
        ) AS rank
    FROM app_provider_connections
    WHERE provider IN ('openrouter', 'openai-codex')
),
provider_connection_replacements AS (
    SELECT id, keeper_id
    FROM ranked_provider_connections
    WHERE rank > 1
)
UPDATE room_configs
SET
    provider_connection_id = provider_connection_replacements.keeper_id,
    updated_at = now()
FROM provider_connection_replacements
WHERE room_configs.provider_connection_id = provider_connection_replacements.id;

WITH ranked_provider_connections AS (
    SELECT
        id,
        provider,
        first_value(id) OVER (
            PARTITION BY provider
            ORDER BY updated_at DESC, created_at DESC, id DESC
        ) AS keeper_id,
        row_number() OVER (
            PARTITION BY provider
            ORDER BY updated_at DESC, created_at DESC, id DESC
        ) AS rank
    FROM app_provider_connections
    WHERE provider IN ('openrouter', 'openai-codex')
),
provider_connection_replacements AS (
    SELECT id, keeper_id
    FROM ranked_provider_connections
    WHERE rank > 1
)
UPDATE app_settings
SET
    default_provider_connection_id = provider_connection_replacements.keeper_id,
    updated_at = now()
FROM provider_connection_replacements
WHERE app_settings.default_provider_connection_id = provider_connection_replacements.id;

WITH ranked_provider_connections AS (
    SELECT
        id,
        provider,
        row_number() OVER (
            PARTITION BY provider
            ORDER BY updated_at DESC, created_at DESC, id DESC
        ) AS rank
    FROM app_provider_connections
    WHERE provider IN ('openrouter', 'openai-codex')
),
removed_duplicate_provider_connections AS (
    DELETE FROM app_provider_connections
    WHERE id IN (
        SELECT id
        FROM ranked_provider_connections
        WHERE rank > 1
    )
    RETURNING credential_secret_id
)
INSERT INTO removed_model_provider_secret_ids (id)
SELECT credential_secret_id
FROM removed_duplicate_provider_connections
WHERE credential_secret_id IS NOT NULL
ON CONFLICT DO NOTHING;

UPDATE app_provider_connections
SET
    auth_mode = 'oauth',
    api = 'openai-codex-responses',
    base_url = 'https://chatgpt.com/backend-api',
    credential_secret_id = NULL,
    updated_at = now()
WHERE provider = 'openai-codex';

UPDATE app_provider_connections
SET
    auth_mode = 'api_key',
    api = 'openai-completions',
    base_url = COALESCE(base_url, 'https://openrouter.ai/api/v1'),
    updated_at = now()
WHERE provider = 'openrouter';

DELETE FROM secrets AS candidate
WHERE id IN (
    SELECT id
    FROM removed_model_provider_secret_ids
)
AND NOT EXISTS (
    SELECT 1 FROM app_provider_connections WHERE credential_secret_id = candidate.id
)
AND NOT EXISTS (
    SELECT 1 FROM app_mcp_connections WHERE credential_secret_id = candidate.id
)
AND NOT EXISTS (
    SELECT 1 FROM room_configs WHERE image_secret_id = candidate.id
)
AND NOT EXISTS (
    SELECT 1 FROM room_secrets WHERE secret_id = candidate.id
)
AND NOT EXISTS (
    SELECT 1 FROM app_github_apps
    WHERE
        client_secret_secret_id = candidate.id
        OR private_key_secret_id = candidate.id
        OR webhook_secret_secret_id = candidate.id
)
AND NOT EXISTS (
    SELECT 1 FROM app_github_user_connections
    WHERE
        access_token_secret_id = candidate.id
        OR refresh_token_secret_id = candidate.id
);

ALTER TABLE app_provider_connections
DROP CONSTRAINT IF EXISTS app_provider_connections_provider_check;

ALTER TABLE app_provider_connections
ADD CONSTRAINT app_provider_connections_provider_check
CHECK (provider IN ('openrouter', 'openai-codex'));

CREATE UNIQUE INDEX IF NOT EXISTS app_provider_connections_provider_unique_idx
ON app_provider_connections(provider);

ALTER TABLE app_provider_connections
DROP CONSTRAINT IF EXISTS app_provider_connections_auth_secret_check;

ALTER TABLE app_provider_connections
ADD CONSTRAINT app_provider_connections_auth_secret_check
CHECK (
    (
        provider = 'openrouter'
        AND auth_mode = 'api_key'
        AND api = 'openai-completions'
        AND credential_secret_id IS NOT NULL
    )
    OR (
        provider = 'openai-codex'
        AND auth_mode = 'oauth'
        AND api = 'openai-codex-responses'
        AND credential_secret_id IS NULL
    )
);

-- migrate:down
DROP INDEX IF EXISTS app_provider_connections_provider_unique_idx;

ALTER TABLE app_provider_connections
DROP CONSTRAINT IF EXISTS app_provider_connections_auth_secret_check;

ALTER TABLE app_provider_connections
DROP CONSTRAINT IF EXISTS app_provider_connections_provider_check;

ALTER TABLE room_configs
ADD COLUMN IF NOT EXISTS provider TEXT,
ADD COLUMN IF NOT EXISTS provider_api TEXT,
ADD COLUMN IF NOT EXISTS provider_base_url TEXT,
ADD COLUMN IF NOT EXISTS provider_model TEXT,
ADD COLUMN IF NOT EXISTS provider_secret_id UUID REFERENCES secrets(id) ON DELETE SET NULL;

ALTER TABLE room_secrets
DROP CONSTRAINT IF EXISTS room_secrets_purpose_check;

ALTER TABLE room_secrets
ADD CONSTRAINT room_secrets_purpose_check
CHECK (purpose IN ('provider_api_key', 'generic', 'webhook'));

ALTER TABLE room_configs
DROP CONSTRAINT IF EXISTS room_configs_provider_mode_check;

ALTER TABLE room_configs
ADD CONSTRAINT room_configs_provider_mode_check
CHECK (provider_mode IN ('app_default', 'app_connection', 'room_secret'));

INSERT INTO secrets (
    id,
    key_name,
    cipher_text,
    nonce,
    auth_tag,
    key_version,
    created_at,
    updated_at
)
SELECT
    id,
    key_name,
    cipher_text,
    nonce,
    auth_tag,
    key_version,
    created_at,
    updated_at
FROM migration_202606110001_secrets_backup
ON CONFLICT (id) DO UPDATE
SET
    key_name = excluded.key_name,
    cipher_text = excluded.cipher_text,
    nonce = excluded.nonce,
    auth_tag = excluded.auth_tag,
    key_version = excluded.key_version,
    created_at = excluded.created_at,
    updated_at = excluded.updated_at;

INSERT INTO app_provider_connections (
    id,
    label,
    provider,
    api,
    base_url,
    default_model,
    fallback_models,
    credential_secret_id,
    status,
    validation_message,
    last_validated_at,
    created_by_user_id,
    created_at,
    updated_at,
    auth_mode
)
SELECT
    id,
    label,
    provider,
    api,
    base_url,
    default_model,
    fallback_models,
    credential_secret_id,
    status,
    validation_message,
    last_validated_at,
    created_by_user_id,
    created_at,
    updated_at,
    auth_mode
FROM migration_202606110001_app_provider_connections_backup
ON CONFLICT (id) DO UPDATE
SET
    label = excluded.label,
    provider = excluded.provider,
    api = excluded.api,
    base_url = excluded.base_url,
    default_model = excluded.default_model,
    fallback_models = excluded.fallback_models,
    credential_secret_id = excluded.credential_secret_id,
    status = excluded.status,
    validation_message = excluded.validation_message,
    last_validated_at = excluded.last_validated_at,
    created_by_user_id = excluded.created_by_user_id,
    created_at = excluded.created_at,
    updated_at = excluded.updated_at,
    auth_mode = excluded.auth_mode;

INSERT INTO app_settings (
    id,
    default_provider_connection_id,
    default_model,
    capability_defaults,
    search_config,
    image_config,
    onboarding_completed_at,
    created_at,
    updated_at
)
SELECT
    id,
    default_provider_connection_id,
    default_model,
    capability_defaults,
    search_config,
    image_config,
    onboarding_completed_at,
    created_at,
    updated_at
FROM migration_202606110001_app_settings_backup
ON CONFLICT (id) DO UPDATE
SET
    default_provider_connection_id = excluded.default_provider_connection_id,
    default_model = excluded.default_model,
    capability_defaults = excluded.capability_defaults,
    search_config = excluded.search_config,
    image_config = excluded.image_config,
    onboarding_completed_at = excluded.onboarding_completed_at,
    created_at = excluded.created_at,
    updated_at = excluded.updated_at;

UPDATE room_configs
SET
    provider_mode = backup.provider_mode,
    provider_connection_id = backup.provider_connection_id,
    provider = backup.provider,
    provider_api = backup.provider_api,
    provider_base_url = backup.provider_base_url,
    provider_model = backup.provider_model,
    provider_secret_id = backup.provider_secret_id,
    updated_at = backup.updated_at
FROM migration_202606110001_room_configs_backup AS backup
WHERE room_configs.room_id = backup.room_id;

INSERT INTO room_secrets (
    id,
    room_id,
    secret_id,
    label,
    env_key,
    purpose,
    provider,
    created_by_user_id,
    created_at,
    updated_at
)
SELECT
    id,
    room_id,
    secret_id,
    label,
    env_key,
    purpose,
    provider,
    created_by_user_id,
    created_at,
    updated_at
FROM migration_202606110001_room_secrets_backup
ON CONFLICT (id) DO UPDATE
SET
    room_id = excluded.room_id,
    secret_id = excluded.secret_id,
    label = excluded.label,
    env_key = excluded.env_key,
    purpose = excluded.purpose,
    provider = excluded.provider,
    created_by_user_id = excluded.created_by_user_id,
    created_at = excluded.created_at,
    updated_at = excluded.updated_at;

ALTER TABLE app_provider_connections
ADD CONSTRAINT app_provider_connections_auth_secret_check
CHECK (
    auth_mode = 'oauth'
    OR credential_secret_id IS NOT NULL
    OR provider IN ('ollama', 'lmstudio')
);

DROP TABLE IF EXISTS migration_202606110001_room_configs_backup;
DROP TABLE IF EXISTS migration_202606110001_room_secrets_backup;
DROP TABLE IF EXISTS migration_202606110001_app_provider_connections_backup;
DROP TABLE IF EXISTS migration_202606110001_app_settings_backup;
DROP TABLE IF EXISTS migration_202606110001_secrets_backup;
