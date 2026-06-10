-- migrate:up
CREATE FUNCTION agent_room_canonical_codex_model(model_ref TEXT)
RETURNS TEXT
LANGUAGE SQL
IMMUTABLE
AS $$
    SELECT CASE
        WHEN model_ref LIKE 'openai/%' THEN 'openai-codex/' || substring(model_ref FROM 8)
        WHEN model_ref LIKE 'codex/%' THEN 'openai-codex/' || substring(model_ref FROM 7)
        ELSE model_ref
    END
$$;

UPDATE app_provider_connections
SET
    default_model = agent_room_canonical_codex_model(default_model),
    fallback_models = COALESCE(
        (
            SELECT jsonb_agg(agent_room_canonical_codex_model(value))
            FROM jsonb_array_elements_text(fallback_models) AS value
        ),
        '[]'::jsonb
    )
WHERE provider = 'openai-codex' OR api = 'openai-codex-responses';

UPDATE app_settings
SET default_model = agent_room_canonical_codex_model(default_model)
WHERE
    default_model IS NOT NULL
    AND default_provider_connection_id IN (
        SELECT id
        FROM app_provider_connections
        WHERE provider = 'openai-codex' OR api = 'openai-codex-responses'
    );

DROP FUNCTION agent_room_canonical_codex_model(TEXT);

-- migrate:down
