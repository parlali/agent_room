PRAGMA defer_foreign_keys = ON;

ALTER TABLE hosted_billing_account ADD COLUMN billing_frozen INTEGER NOT NULL DEFAULT 0 CHECK (billing_frozen IN (0, 1));

DROP TABLE IF EXISTS hosted_billing_ledger_entry_migrated;

DROP TRIGGER IF EXISTS hosted_usage_event_delete_clear_billing_ledger_usage_id;
DROP TRIGGER IF EXISTS hosted_billing_ledger_entry_delete_clear_usage_event_ledger_id;
DROP TRIGGER IF EXISTS hosted_billing_ledger_entry_delete_clear_billing_reservation_ledger_id;
DROP TRIGGER IF EXISTS hosted_billing_reservation_insert_same_room_ledger;
DROP TRIGGER IF EXISTS hosted_billing_reservation_update_same_room_ledger;

CREATE TABLE hosted_billing_ledger_entry_migrated (
    id TEXT PRIMARY KEY NOT NULL,
    workspace_id TEXT NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
    direction TEXT NOT NULL CHECK (direction IN ('credit', 'debit')),
    source TEXT NOT NULL CHECK (source IN ('subscription_included_credit', 'included_credit_expiry', 'stripe_topup', 'stripe_refund_clawback', 'stripe_dispute_clawback', 'hosted_openrouter_usage', 'hosted_brave_usage', 'hosted_browserbase_usage', 'hosted_fetch_url_usage', 'manual_adjustment')),
    amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
    balance_after_cents INTEGER NOT NULL CHECK (balance_after_cents >= 0),
    stripe_event_id TEXT,
    stripe_checkout_session_id TEXT,
    stripe_invoice_id TEXT,
    stripe_payment_intent_id TEXT,
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
    stripe_payment_intent_id,
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
    NULL,
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
CREATE INDEX hosted_billing_ledger_payment_intent_idx ON hosted_billing_ledger_entry(stripe_payment_intent_id);

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

CREATE TRIGGER hosted_billing_ledger_entry_delete_clear_billing_reservation_ledger_id
BEFORE DELETE ON hosted_billing_ledger_entry
BEGIN
    UPDATE hosted_billing_reservation
    SET billing_ledger_entry_id = NULL
    WHERE workspace_id = OLD.workspace_id
      AND billing_ledger_entry_id = OLD.id;
END;

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

PRAGMA defer_foreign_keys = OFF;
