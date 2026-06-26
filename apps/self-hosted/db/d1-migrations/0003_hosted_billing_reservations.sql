PRAGMA foreign_keys = ON;

ALTER TABLE hosted_billing_account ADD COLUMN included_reserved_cents INTEGER NOT NULL DEFAULT 0 CHECK (included_reserved_cents >= 0);
ALTER TABLE hosted_billing_account ADD COLUMN purchased_reserved_cents INTEGER NOT NULL DEFAULT 0 CHECK (purchased_reserved_cents >= 0);

CREATE TABLE hosted_billing_reservation (
    id TEXT PRIMARY KEY NOT NULL,
    workspace_id TEXT NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
    room_id TEXT,
    session_key TEXT,
    run_id TEXT,
    job_id TEXT,
    provider TEXT NOT NULL CHECK (provider IN ('openrouter', 'brave', 'browserbase', 'fetch_url')),
    status TEXT NOT NULL CHECK (status IN ('authorized', 'settled', 'released', 'expired')),
    reserved_cents INTEGER NOT NULL CHECK (reserved_cents > 0),
    included_reserved_cents INTEGER NOT NULL DEFAULT 0 CHECK (included_reserved_cents >= 0),
    purchased_reserved_cents INTEGER NOT NULL DEFAULT 0 CHECK (purchased_reserved_cents >= 0),
    settled_cents INTEGER NOT NULL DEFAULT 0 CHECK (settled_cents >= 0),
    usage_event_id TEXT,
    billing_ledger_entry_id TEXT,
    idempotency_key TEXT NOT NULL,
    metadata TEXT NOT NULL DEFAULT '{}',
    expires_at DATE NOT NULL,
    created_at DATE NOT NULL,
    updated_at DATE NOT NULL,
    UNIQUE(workspace_id, id),
    UNIQUE(workspace_id, idempotency_key),
    FOREIGN KEY (workspace_id, room_id)
        REFERENCES hosted_room(workspace_id, id)
        ON DELETE CASCADE,
    FOREIGN KEY (workspace_id, job_id)
        REFERENCES hosted_room_job(workspace_id, id)
        ON DELETE RESTRICT,
    FOREIGN KEY (workspace_id, room_id, job_id)
        REFERENCES hosted_room_job(workspace_id, room_id, id)
        ON DELETE RESTRICT,
    FOREIGN KEY (workspace_id, usage_event_id)
        REFERENCES hosted_usage_event(workspace_id, id)
        ON DELETE RESTRICT,
    FOREIGN KEY (workspace_id, room_id, usage_event_id)
        REFERENCES hosted_usage_event(workspace_id, room_id, id)
        ON DELETE RESTRICT,
    FOREIGN KEY (workspace_id, billing_ledger_entry_id)
        REFERENCES hosted_billing_ledger_entry(workspace_id, id)
        ON DELETE RESTRICT,
    FOREIGN KEY (workspace_id, usage_event_id, billing_ledger_entry_id)
        REFERENCES hosted_billing_ledger_entry(workspace_id, usage_event_id, id)
        ON DELETE RESTRICT,
    CHECK (included_reserved_cents + purchased_reserved_cents = reserved_cents),
    CHECK (settled_cents <= reserved_cents)
);

CREATE INDEX hosted_billing_reservation_workspace_status_idx ON hosted_billing_reservation(workspace_id, status);
CREATE INDEX hosted_billing_reservation_expires_at_idx ON hosted_billing_reservation(expires_at);
CREATE INDEX hosted_billing_reservation_usage_event_idx ON hosted_billing_reservation(usage_event_id);

CREATE TRIGGER hosted_billing_reservation_insert_same_room_ledger
BEFORE INSERT ON hosted_billing_reservation
WHEN NEW.room_id IS NOT NULL
 AND NEW.billing_ledger_entry_id IS NOT NULL
 AND NOT EXISTS (
     SELECT 1
     FROM hosted_billing_ledger_entry AS ledger
     INNER JOIN hosted_usage_event AS usage
        ON usage.workspace_id = ledger.workspace_id
       AND usage.id = ledger.usage_event_id
     WHERE ledger.workspace_id = NEW.workspace_id
       AND ledger.id = NEW.billing_ledger_entry_id
       AND usage.room_id = NEW.room_id
 )
BEGIN
    SELECT RAISE(ABORT, 'Hosted billing reservation ledger must belong to the same room');
END;

CREATE TRIGGER hosted_billing_reservation_update_same_room_ledger
BEFORE UPDATE OF room_id, billing_ledger_entry_id ON hosted_billing_reservation
WHEN NEW.room_id IS NOT NULL
 AND NEW.billing_ledger_entry_id IS NOT NULL
 AND NOT EXISTS (
     SELECT 1
     FROM hosted_billing_ledger_entry AS ledger
     INNER JOIN hosted_usage_event AS usage
        ON usage.workspace_id = ledger.workspace_id
       AND usage.id = ledger.usage_event_id
     WHERE ledger.workspace_id = NEW.workspace_id
       AND ledger.id = NEW.billing_ledger_entry_id
       AND usage.room_id = NEW.room_id
 )
BEGIN
    SELECT RAISE(ABORT, 'Hosted billing reservation ledger must belong to the same room');
END;

CREATE TRIGGER hosted_room_delete_clear_billing_reservation_room_id
BEFORE DELETE ON hosted_room
BEGIN
    UPDATE hosted_billing_reservation
    SET room_id = NULL
    WHERE workspace_id = OLD.workspace_id
      AND room_id = OLD.id;
END;

CREATE TRIGGER hosted_room_job_delete_clear_billing_reservation_job_id
BEFORE DELETE ON hosted_room_job
BEGIN
    UPDATE hosted_billing_reservation
    SET job_id = NULL
    WHERE workspace_id = OLD.workspace_id
      AND job_id = OLD.id;
END;

CREATE TRIGGER hosted_usage_event_delete_clear_billing_reservation_usage_id
BEFORE DELETE ON hosted_usage_event
BEGIN
    UPDATE hosted_billing_reservation
    SET usage_event_id = NULL
    WHERE workspace_id = OLD.workspace_id
      AND usage_event_id = OLD.id;
END;

CREATE TRIGGER hosted_billing_ledger_entry_delete_clear_billing_reservation_ledger_id
BEFORE DELETE ON hosted_billing_ledger_entry
BEGIN
    UPDATE hosted_billing_reservation
    SET billing_ledger_entry_id = NULL
    WHERE workspace_id = OLD.workspace_id
      AND billing_ledger_entry_id = OLD.id;
END;
