PRAGMA foreign_keys = OFF;

DROP TABLE IF EXISTS hosted_billing_ledger_entry_migrated;
DROP TABLE IF EXISTS hosted_billing_reservation_migrated;

DROP TRIGGER IF EXISTS hosted_usage_event_delete_clear_billing_ledger_usage_id;
DROP TRIGGER IF EXISTS hosted_billing_ledger_entry_delete_clear_usage_event_ledger_id;
DROP TRIGGER IF EXISTS hosted_billing_ledger_entry_delete_clear_billing_reservation_ledger_id;
DROP TRIGGER IF EXISTS hosted_billing_reservation_insert_same_room_ledger;
DROP TRIGGER IF EXISTS hosted_billing_reservation_update_same_room_ledger;
DROP TRIGGER IF EXISTS hosted_room_delete_clear_billing_reservation_room_id;
DROP TRIGGER IF EXISTS hosted_room_job_delete_clear_billing_reservation_job_id;
DROP TRIGGER IF EXISTS hosted_usage_event_delete_clear_billing_reservation_usage_id;

CREATE TABLE hosted_billing_ledger_entry_migrated (
    id TEXT PRIMARY KEY NOT NULL,
    workspace_id TEXT NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
    direction TEXT NOT NULL CHECK (direction IN ('credit', 'debit')),
    source TEXT NOT NULL CHECK (source IN ('subscription_included_credit', 'included_credit_expiry', 'stripe_topup', 'hosted_openrouter_usage', 'hosted_brave_usage', 'hosted_browserbase_usage', 'hosted_fetch_url_usage', 'manual_adjustment')),
    amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
    balance_after_cents INTEGER NOT NULL CHECK (balance_after_cents >= 0),
    stripe_event_id TEXT,
    stripe_checkout_session_id TEXT,
    stripe_invoice_id TEXT,
    usage_event_id TEXT,
    idempotency_key TEXT NOT NULL,
    metadata TEXT NOT NULL DEFAULT '{}',
    created_at DATE NOT NULL,
    UNIQUE(workspace_id, id),
    UNIQUE(workspace_id, usage_event_id, id),
    UNIQUE(workspace_id, idempotency_key),
    FOREIGN KEY (workspace_id, usage_event_id)
        REFERENCES hosted_usage_event(workspace_id, id)
        ON DELETE RESTRICT
);

INSERT INTO hosted_billing_ledger_entry_migrated (
    id,
    workspace_id,
    direction,
    source,
    amount_cents,
    balance_after_cents,
    stripe_event_id,
    stripe_checkout_session_id,
    stripe_invoice_id,
    usage_event_id,
    idempotency_key,
    metadata,
    created_at
)
SELECT
    id,
    workspace_id,
    direction,
    source,
    amount_cents,
    balance_after_cents,
    stripe_event_id,
    stripe_checkout_session_id,
    stripe_invoice_id,
    usage_event_id,
    idempotency_key,
    metadata,
    created_at
FROM hosted_billing_ledger_entry;

DROP TABLE hosted_billing_ledger_entry;
ALTER TABLE hosted_billing_ledger_entry_migrated RENAME TO hosted_billing_ledger_entry;

CREATE INDEX hosted_billing_ledger_workspace_created_idx ON hosted_billing_ledger_entry(workspace_id, created_at);
CREATE INDEX hosted_billing_ledger_stripe_event_idx ON hosted_billing_ledger_entry(stripe_event_id);
CREATE INDEX hosted_billing_ledger_usage_event_idx ON hosted_billing_ledger_entry(usage_event_id);

CREATE TRIGGER hosted_billing_ledger_entry_delete_clear_usage_event_ledger_id
BEFORE DELETE ON hosted_billing_ledger_entry
BEGIN
    UPDATE hosted_usage_event
    SET billing_ledger_entry_id = NULL
    WHERE workspace_id = OLD.workspace_id
      AND billing_ledger_entry_id = OLD.id;
END;

CREATE TRIGGER hosted_usage_event_delete_clear_billing_ledger_usage_id
BEFORE DELETE ON hosted_usage_event
BEGIN
    UPDATE hosted_billing_ledger_entry
    SET usage_event_id = NULL
    WHERE workspace_id = OLD.workspace_id
      AND usage_event_id = OLD.id;
END;

CREATE TABLE hosted_billing_reservation_migrated (
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

INSERT INTO hosted_billing_reservation_migrated (
    id,
    workspace_id,
    room_id,
    session_key,
    run_id,
    job_id,
    provider,
    status,
    reserved_cents,
    included_reserved_cents,
    purchased_reserved_cents,
    settled_cents,
    usage_event_id,
    billing_ledger_entry_id,
    idempotency_key,
    metadata,
    expires_at,
    created_at,
    updated_at
)
SELECT
    id,
    workspace_id,
    room_id,
    session_key,
    run_id,
    job_id,
    provider,
    status,
    reserved_cents,
    included_reserved_cents,
    purchased_reserved_cents,
    settled_cents,
    usage_event_id,
    billing_ledger_entry_id,
    idempotency_key,
    metadata,
    expires_at,
    created_at,
    updated_at
FROM hosted_billing_reservation;

DROP TABLE hosted_billing_reservation;
ALTER TABLE hosted_billing_reservation_migrated RENAME TO hosted_billing_reservation;

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

CREATE TRIGGER hosted_billing_ledger_entry_delete_clear_billing_reservation_ledger_id
BEFORE DELETE ON hosted_billing_ledger_entry
BEGIN
    UPDATE hosted_billing_reservation
    SET billing_ledger_entry_id = NULL
    WHERE workspace_id = OLD.workspace_id
      AND billing_ledger_entry_id = OLD.id;
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

PRAGMA foreign_keys = ON;
