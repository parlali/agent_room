-- migrate:up
ALTER TABLE rooms DROP CONSTRAINT IF EXISTS rooms_sandbox_mode_check;
ALTER TABLE rooms DROP COLUMN IF EXISTS sandbox_mode;

-- migrate:down
ALTER TABLE rooms ADD COLUMN sandbox_mode TEXT;
UPDATE rooms SET sandbox_mode = 'docker' WHERE sandbox_mode IS NULL;
ALTER TABLE rooms ALTER COLUMN sandbox_mode SET NOT NULL;
ALTER TABLE rooms
    ADD CONSTRAINT rooms_sandbox_mode_check
    CHECK (sandbox_mode IN ('host', 'docker', 'nemoclaw'));
