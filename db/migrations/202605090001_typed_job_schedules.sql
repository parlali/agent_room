-- migrate:up
ALTER TABLE room_cron_jobs
ADD COLUMN IF NOT EXISTS schedule JSONB;

UPDATE room_cron_jobs
SET schedule = jsonb_build_object(
    'type',
    'interval',
    'every',
    every_minutes,
    'unit',
    'minutes'
)
WHERE schedule IS NULL;

ALTER TABLE room_cron_jobs
ALTER COLUMN schedule SET DEFAULT '{"type":"daily","times":["09:00"]}'::jsonb,
ALTER COLUMN schedule SET NOT NULL;

-- migrate:down
ALTER TABLE room_cron_jobs
DROP COLUMN IF EXISTS schedule;
