PRAGMA foreign_keys = ON;

CREATE TABLE "user" (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    emailVerified INTEGER NOT NULL,
    image TEXT,
    createdAt DATE NOT NULL,
    updatedAt DATE NOT NULL
);

CREATE TABLE "session" (
    id TEXT PRIMARY KEY NOT NULL,
    expiresAt DATE NOT NULL,
    token TEXT NOT NULL UNIQUE,
    createdAt DATE NOT NULL,
    updatedAt DATE NOT NULL,
    ipAddress TEXT,
    userAgent TEXT,
    userId TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
    activeOrganizationId TEXT
);

CREATE INDEX session_userId_idx ON "session"(userId);

CREATE TABLE account (
    id TEXT PRIMARY KEY NOT NULL,
    accountId TEXT NOT NULL,
    providerId TEXT NOT NULL,
    userId TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
    accessToken TEXT,
    refreshToken TEXT,
    idToken TEXT,
    accessTokenExpiresAt DATE,
    refreshTokenExpiresAt DATE,
    scope TEXT,
    password TEXT,
    createdAt DATE NOT NULL,
    updatedAt DATE NOT NULL
);

CREATE INDEX account_userId_idx ON account(userId);

CREATE TABLE verification (
    id TEXT PRIMARY KEY NOT NULL,
    identifier TEXT NOT NULL,
    value TEXT NOT NULL,
    expiresAt DATE NOT NULL,
    createdAt DATE NOT NULL,
    updatedAt DATE NOT NULL
);

CREATE INDEX verification_identifier_idx ON verification(identifier);

CREATE TABLE organization (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE,
    logo TEXT,
    createdAt DATE NOT NULL,
    metadata TEXT
);

CREATE INDEX organization_slug_idx ON organization(slug);

CREATE TABLE member (
    id TEXT PRIMARY KEY NOT NULL,
    organizationId TEXT NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
    userId TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
    role TEXT NOT NULL,
    createdAt DATE NOT NULL,
    UNIQUE(organizationId, userId)
);

CREATE INDEX member_organizationId_idx ON member(organizationId);
CREATE INDEX member_userId_idx ON member(userId);

CREATE TABLE invitation (
    id TEXT PRIMARY KEY NOT NULL,
    organizationId TEXT NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
    email TEXT NOT NULL,
    role TEXT,
    status TEXT NOT NULL,
    expiresAt DATE NOT NULL,
    createdAt DATE NOT NULL,
    inviterId TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE
);

CREATE INDEX invitation_organizationId_idx ON invitation(organizationId);
CREATE INDEX invitation_email_idx ON invitation(email);

CREATE TABLE hosted_room (
    id TEXT PRIMARY KEY NOT NULL,
    workspace_id TEXT NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
    slug TEXT NOT NULL,
    display_name TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('starting', 'running', 'stopped', 'degraded', 'failed', 'setup_required')),
    desired_state TEXT NOT NULL CHECK (desired_state IN ('running', 'stopped')),
    created_by_user_id TEXT NOT NULL,
    created_at DATE NOT NULL,
    updated_at DATE NOT NULL,
    UNIQUE(workspace_id, slug),
    UNIQUE(workspace_id, id),
    FOREIGN KEY (workspace_id, created_by_user_id)
        REFERENCES member(organizationId, userId)
);

CREATE INDEX hosted_room_workspace_id_idx ON hosted_room(workspace_id);
CREATE INDEX hosted_room_created_by_user_id_idx ON hosted_room(created_by_user_id);

CREATE TABLE hosted_room_runtime_state (
    room_id TEXT PRIMARY KEY NOT NULL,
    workspace_id TEXT NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
    container_name TEXT NOT NULL,
    config_object_key TEXT,
    workspace_snapshot_key TEXT,
    config_version INTEGER NOT NULL DEFAULT 1,
    token_version INTEGER NOT NULL DEFAULT 1,
    health_status TEXT NOT NULL CHECK (health_status IN ('unknown', 'healthy', 'unhealthy')) DEFAULT 'unknown',
    started_at DATE,
    last_health_at DATE,
    last_error TEXT,
    updated_at DATE NOT NULL,
    UNIQUE(workspace_id, container_name),
    FOREIGN KEY (workspace_id, room_id)
        REFERENCES hosted_room(workspace_id, id)
        ON DELETE CASCADE
);

CREATE INDEX hosted_room_runtime_state_workspace_id_idx ON hosted_room_runtime_state(workspace_id);

CREATE TABLE hosted_provider_connection (
    id TEXT PRIMARY KEY NOT NULL,
    workspace_id TEXT NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
    label TEXT NOT NULL,
    provider TEXT NOT NULL,
    auth_mode TEXT NOT NULL CHECK (auth_mode IN ('api_key', 'oauth')),
    api TEXT NOT NULL CHECK (api IN ('openai-completions', 'openai-codex-responses')),
    base_url TEXT,
    default_model TEXT NOT NULL,
    fallback_models TEXT NOT NULL,
    credential_secret_id TEXT,
    status TEXT NOT NULL CHECK (status IN ('unchecked', 'ready', 'invalid')),
    validation_message TEXT,
    last_validated_at DATE,
    created_by_user_id TEXT REFERENCES "user"(id) ON DELETE SET NULL,
    created_at DATE NOT NULL,
    updated_at DATE NOT NULL,
    UNIQUE(workspace_id, provider, label)
);

CREATE INDEX hosted_provider_connection_workspace_id_idx ON hosted_provider_connection(workspace_id);

CREATE TABLE hosted_mcp_connection (
    id TEXT PRIMARY KEY NOT NULL,
    workspace_id TEXT NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    server_key TEXT NOT NULL,
    transport TEXT NOT NULL CHECK (transport IN ('stdio', 'http', 'streamable_http')),
    command TEXT,
    args TEXT NOT NULL,
    url TEXT,
    headers TEXT NOT NULL,
    auth_mode TEXT NOT NULL CHECK (auth_mode IN ('none', 'bearer')),
    credential_secret_id TEXT,
    allowed_tools TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('unchecked', 'ready', 'invalid')),
    validation_message TEXT,
    last_validated_at DATE,
    created_by_user_id TEXT REFERENCES "user"(id) ON DELETE SET NULL,
    created_at DATE NOT NULL,
    updated_at DATE NOT NULL,
    UNIQUE(workspace_id, server_key)
);

CREATE INDEX hosted_mcp_connection_workspace_id_idx ON hosted_mcp_connection(workspace_id);

CREATE TABLE hosted_room_job (
    id TEXT PRIMARY KEY NOT NULL,
    workspace_id TEXT NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
    room_id TEXT NOT NULL,
    name TEXT NOT NULL,
    message TEXT NOT NULL,
    enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
    schedule TEXT NOT NULL,
    timezone TEXT NOT NULL,
    next_run_at DATE,
    running_at DATE,
    locked_until DATE,
    lock_token TEXT,
    last_run_at DATE,
    last_run_status TEXT,
    last_error TEXT,
    created_at DATE NOT NULL,
    updated_at DATE NOT NULL,
    FOREIGN KEY (workspace_id, room_id)
        REFERENCES hosted_room(workspace_id, id)
        ON DELETE CASCADE
);

CREATE INDEX hosted_room_job_workspace_id_idx ON hosted_room_job(workspace_id);
CREATE INDEX hosted_room_job_room_id_idx ON hosted_room_job(room_id);
CREATE INDEX hosted_room_job_next_run_at_idx ON hosted_room_job(next_run_at);

CREATE TABLE hosted_billing_account (
    workspace_id TEXT PRIMARY KEY NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
    stripe_customer_id TEXT UNIQUE,
    stripe_subscription_id TEXT UNIQUE,
    plan_key TEXT NOT NULL DEFAULT 'none',
    plan_status TEXT NOT NULL CHECK (plan_status IN ('none', 'incomplete', 'trialing', 'active', 'past_due', 'canceled', 'unpaid')) DEFAULT 'none',
    included_balance_cents INTEGER NOT NULL DEFAULT 0 CHECK (included_balance_cents >= 0),
    purchased_balance_cents INTEGER NOT NULL DEFAULT 0 CHECK (purchased_balance_cents >= 0),
    included_monthly_credit_cents INTEGER NOT NULL DEFAULT 0 CHECK (included_monthly_credit_cents >= 0),
    created_at DATE NOT NULL,
    updated_at DATE NOT NULL
);

CREATE INDEX hosted_billing_account_stripe_customer_idx ON hosted_billing_account(stripe_customer_id);

CREATE TABLE hosted_billing_ledger_entry (
    id TEXT PRIMARY KEY NOT NULL,
    workspace_id TEXT NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
    direction TEXT NOT NULL CHECK (direction IN ('credit', 'debit')),
    source TEXT NOT NULL CHECK (source IN ('subscription_included_credit', 'included_credit_expiry', 'stripe_topup', 'hosted_openrouter_usage', 'hosted_brave_usage', 'manual_adjustment')),
    amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
    balance_after_cents INTEGER NOT NULL CHECK (balance_after_cents >= 0),
    stripe_event_id TEXT,
    stripe_checkout_session_id TEXT,
    stripe_invoice_id TEXT,
    usage_event_id TEXT REFERENCES hosted_usage_event(id) ON DELETE RESTRICT,
    idempotency_key TEXT NOT NULL,
    metadata TEXT NOT NULL DEFAULT '{}',
    created_at DATE NOT NULL,
    UNIQUE(workspace_id, idempotency_key)
);

CREATE INDEX hosted_billing_ledger_workspace_created_idx ON hosted_billing_ledger_entry(workspace_id, created_at);
CREATE INDEX hosted_billing_ledger_stripe_event_idx ON hosted_billing_ledger_entry(stripe_event_id);
CREATE INDEX hosted_billing_ledger_usage_event_idx ON hosted_billing_ledger_entry(usage_event_id);

CREATE TABLE hosted_stripe_event (
    id TEXT PRIMARY KEY NOT NULL,
    type TEXT NOT NULL,
    livemode INTEGER NOT NULL CHECK (livemode IN (0, 1)),
    processed_at DATE NOT NULL
);

CREATE TABLE hosted_usage_event (
    id TEXT PRIMARY KEY NOT NULL,
    workspace_id TEXT NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
    room_id TEXT,
    session_key TEXT,
    run_id TEXT,
    job_id TEXT REFERENCES hosted_room_job(id) ON DELETE SET NULL,
    kind TEXT NOT NULL CHECK (kind IN ('run', 'provider', 'tool', 'document_worker', 'image', 'job')),
    provider TEXT,
    model TEXT,
    tool_name TEXT,
    input_tokens INTEGER,
    output_tokens INTEGER,
    cached_tokens INTEGER,
    cost_micros INTEGER,
    billing_status TEXT NOT NULL CHECK (billing_status IN ('not_billable', 'pending', 'debited', 'blocked')) DEFAULT 'not_billable',
    billing_ledger_entry_id TEXT,
    created_at DATE NOT NULL,
    FOREIGN KEY (workspace_id, room_id)
        REFERENCES hosted_room(workspace_id, id)
        ON DELETE CASCADE,
    FOREIGN KEY (billing_ledger_entry_id)
        REFERENCES hosted_billing_ledger_entry(id)
        ON DELETE SET NULL
);

CREATE INDEX hosted_usage_event_workspace_id_idx ON hosted_usage_event(workspace_id);
CREATE INDEX hosted_usage_event_room_id_idx ON hosted_usage_event(room_id);
CREATE INDEX hosted_usage_event_created_at_idx ON hosted_usage_event(created_at);
CREATE INDEX hosted_usage_event_billing_status_idx ON hosted_usage_event(workspace_id, billing_status);
