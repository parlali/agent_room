import { sql, type SQL } from 'drizzle-orm'
import {
    blob,
    check,
    index,
    integer,
    primaryKey,
    sqliteTable,
    text,
    uniqueIndex,
    type AnySQLiteColumn,
} from 'drizzle-orm/sqlite-core'
import type { JsonValue } from '../../domain/domain-types'
import {
    artifactKinds,
    connectionStatuses,
    cronRunStatuses,
    healthStatuses,
    imageProviderIds,
    mcpAuthModes,
    mcpTransports,
    providerApis,
    providerAuthModes,
    roomDesiredStates,
    roomModes,
    roomOnboardingStatuses,
    roomProviderModes,
    roomSecretPurposes,
    roomStatuses,
    usageEventKinds,
    userRoles,
} from '../../domain/domain-types'

const providerIds = ['openrouter', 'openai-codex'] as const

function sqlString(value: string): string {
    return `'${value.replaceAll("'", "''")}'`
}

function sqlValueList(values: readonly string[]): SQL {
    return sql.raw(values.map(sqlString).join(', '))
}

function enumCheck(name: string, column: AnySQLiteColumn, values: readonly string[]) {
    return check(name, sql`${column} IN (${sqlValueList(values)})`)
}

function timestamp(name: string) {
    return integer(name, { mode: 'timestamp_ms' })
}

function createdAt() {
    return timestamp('created_at')
        .notNull()
        .default(sql`(unixepoch() * 1000)`)
}

function updatedAt() {
    return timestamp('updated_at')
        .notNull()
        .default(sql`(unixepoch() * 1000)`)
}

function jsonText(name: string, defaultValue: JsonValue) {
    return text(name, { mode: 'json' })
        .$type<JsonValue>()
        .notNull()
        .default(sql.raw(sqlString(JSON.stringify(defaultValue))))
}

export const users = sqliteTable(
    'users',
    {
        id: text('id').primaryKey(),
        email: text('email').notNull(),
        passwordHash: text('password_hash').notNull(),
        role: text('role', { enum: userRoles }).notNull(),
        createdAt: createdAt(),
        updatedAt: updatedAt(),
    },
    (table) => [
        uniqueIndex('users_email_unique').on(table.email),
        enumCheck('users_role_check', table.role, userRoles),
    ],
)

export const sessions = sqliteTable(
    'sessions',
    {
        id: text('id').primaryKey(),
        userId: text('user_id')
            .notNull()
            .references(() => users.id, { onDelete: 'cascade' }),
        tokenHash: text('token_hash').notNull(),
        expiresAt: timestamp('expires_at').notNull(),
        createdAt: createdAt(),
        lastSeenAt: timestamp('last_seen_at'),
        revokedAt: timestamp('revoked_at'),
        userAgent: text('user_agent'),
        ipAddress: text('ip_address'),
    },
    (table) => [
        uniqueIndex('sessions_token_hash_unique').on(table.tokenHash),
        index('sessions_user_id_idx').on(table.userId),
        index('sessions_expires_at_idx').on(table.expiresAt),
    ],
)

export const rooms = sqliteTable(
    'rooms',
    {
        id: text('id').primaryKey(),
        slug: text('slug').notNull(),
        displayName: text('display_name').notNull(),
        status: text('status', { enum: roomStatuses }).notNull(),
        desiredState: text('desired_state', { enum: roomDesiredStates }).notNull(),
        createdByUserId: text('created_by_user_id')
            .notNull()
            .references(() => users.id, { onDelete: 'restrict' }),
        createdAt: createdAt(),
        updatedAt: updatedAt(),
    },
    (table) => [
        uniqueIndex('rooms_slug_unique').on(table.slug),
        enumCheck('rooms_status_check', table.status, roomStatuses),
        enumCheck('rooms_desired_state_check', table.desiredState, roomDesiredStates),
    ],
)

export const roomRuntimeMetadata = sqliteTable(
    'room_runtime_metadata',
    {
        roomId: text('room_id')
            .primaryKey()
            .references(() => rooms.id, { onDelete: 'cascade' }),
        port: integer('port'),
        pid: integer('pid'),
        sandboxUid: integer('sandbox_uid'),
        sandboxGid: integer('sandbox_gid'),
        sandboxUserName: text('sandbox_user_name'),
        sandboxGroupName: text('sandbox_group_name'),
        configVersion: integer('config_version').notNull().default(1),
        tokenVersion: integer('token_version').notNull().default(1),
        healthStatus: text('health_status', { enum: healthStatuses }).notNull().default('unknown'),
        startedAt: timestamp('started_at'),
        lastHealthAt: timestamp('last_health_at'),
        lastError: text('last_error'),
        updatedAt: updatedAt(),
    },
    (table) => [
        enumCheck('room_runtime_metadata_health_status_check', table.healthStatus, healthStatuses),
    ],
)

export const secrets = sqliteTable(
    'secrets',
    {
        id: text('id').primaryKey(),
        keyName: text('key_name').notNull(),
        cipherText: blob('cipher_text', { mode: 'buffer' }).notNull(),
        nonce: blob('nonce', { mode: 'buffer' }).notNull(),
        authTag: blob('auth_tag', { mode: 'buffer' }).notNull(),
        keyVersion: integer('key_version').notNull().default(1),
        createdAt: createdAt(),
        updatedAt: updatedAt(),
    },
    (table) => [uniqueIndex('secrets_key_name_unique').on(table.keyName)],
)

export const artifactIndex = sqliteTable(
    'artifact_index',
    {
        id: text('id').primaryKey(),
        roomId: text('room_id')
            .notNull()
            .references(() => rooms.id, { onDelete: 'cascade' }),
        artifactId: text('artifact_id').notNull(),
        kind: text('kind', { enum: artifactKinds }).notNull(),
        sha256: text('sha256').notNull(),
        byteLength: integer('byte_length').notNull(),
        mediaType: text('media_type').notNull(),
        manifestPath: text('manifest_path').notNull(),
        source: jsonText('source', {}),
        provenance: jsonText('provenance', {}),
        createdBy: text('created_by').notNull(),
        createdAt: createdAt(),
    },
    (table) => [
        uniqueIndex('artifact_index_room_artifact_unique').on(table.roomId, table.artifactId),
        index('artifact_index_room_id_idx').on(table.roomId),
        index('artifact_index_sha_idx').on(table.sha256),
        enumCheck('artifact_index_kind_check', table.kind, artifactKinds),
    ],
)

export const auditEvents = sqliteTable(
    'audit_events',
    {
        id: integer('id').primaryKey({ autoIncrement: true }),
        actorUserId: text('actor_user_id').references(() => users.id, { onDelete: 'set null' }),
        roomId: text('room_id').references(() => rooms.id, { onDelete: 'set null' }),
        action: text('action').notNull(),
        payload: jsonText('payload', {}),
        createdAt: createdAt(),
    },
    (table) => [
        index('audit_events_room_id_idx').on(table.roomId),
        index('audit_events_action_idx').on(table.action),
    ],
)

export const appProviderConnections = sqliteTable(
    'app_provider_connections',
    {
        id: text('id').primaryKey(),
        label: text('label').notNull(),
        provider: text('provider', { enum: providerIds }).notNull(),
        authMode: text('auth_mode', { enum: providerAuthModes }).notNull(),
        api: text('api', { enum: providerApis }).notNull(),
        baseUrl: text('base_url'),
        defaultModel: text('default_model').notNull(),
        fallbackModels: jsonText('fallback_models', []),
        credentialSecretId: text('credential_secret_id').references(() => secrets.id, {
            onDelete: 'set null',
        }),
        status: text('status', { enum: connectionStatuses }).notNull().default('unchecked'),
        validationMessage: text('validation_message'),
        lastValidatedAt: timestamp('last_validated_at'),
        createdByUserId: text('created_by_user_id').references(() => users.id, {
            onDelete: 'set null',
        }),
        createdAt: createdAt(),
        updatedAt: updatedAt(),
    },
    (table) => [
        uniqueIndex('app_provider_connections_provider_unique_idx').on(table.provider),
        enumCheck('app_provider_connections_provider_check', table.provider, providerIds),
        enumCheck('app_provider_connections_auth_mode_check', table.authMode, providerAuthModes),
        enumCheck('app_provider_connections_api_check', table.api, providerApis),
        enumCheck('app_provider_connections_status_check', table.status, connectionStatuses),
        check(
            'app_provider_connections_auth_secret_check',
            sql`(
                (
                    ${table.provider} = 'openrouter'
                    AND ${table.authMode} = 'api_key'
                    AND ${table.api} = 'openai-completions'
                    AND ${table.credentialSecretId} IS NOT NULL
                )
                OR (
                    ${table.provider} = 'openai-codex'
                    AND ${table.authMode} = 'oauth'
                    AND ${table.api} = 'openai-codex-responses'
                    AND ${table.credentialSecretId} IS NULL
                )
            )`,
        ),
    ],
)

export const appMcpConnections = sqliteTable(
    'app_mcp_connections',
    {
        id: text('id').primaryKey(),
        name: text('name').notNull(),
        serverKey: text('server_key').notNull(),
        transport: text('transport', { enum: mcpTransports }).notNull(),
        command: text('command'),
        args: jsonText('args', []),
        url: text('url'),
        headers: jsonText('headers', {}),
        authMode: text('auth_mode', { enum: mcpAuthModes }).notNull().default('none'),
        credentialSecretId: text('credential_secret_id').references(() => secrets.id, {
            onDelete: 'set null',
        }),
        allowedTools: jsonText('allowed_tools', []),
        status: text('status', { enum: connectionStatuses }).notNull().default('unchecked'),
        validationMessage: text('validation_message'),
        lastValidatedAt: timestamp('last_validated_at'),
        createdByUserId: text('created_by_user_id').references(() => users.id, {
            onDelete: 'set null',
        }),
        createdAt: createdAt(),
        updatedAt: updatedAt(),
    },
    (table) => [
        uniqueIndex('app_mcp_connections_server_key_unique').on(table.serverKey),
        index('app_mcp_connections_transport_idx').on(table.transport),
        enumCheck('app_mcp_connections_transport_check', table.transport, mcpTransports),
        enumCheck('app_mcp_connections_auth_mode_check', table.authMode, mcpAuthModes),
        enumCheck('app_mcp_connections_status_check', table.status, connectionStatuses),
        check(
            'app_mcp_connections_endpoint_check',
            sql`(
                (
                    ${table.transport} = 'stdio'
                    AND ${table.command} IS NOT NULL
                    AND length(trim(${table.command})) > 0
                )
                OR (
                    ${table.transport} IN ('http', 'streamable_http')
                    AND ${table.url} IS NOT NULL
                    AND length(trim(${table.url})) > 0
                )
            )`,
        ),
    ],
)

export const appSettings = sqliteTable(
    'app_settings',
    {
        id: integer('id', { mode: 'boolean' })
            .primaryKey()
            .notNull()
            .default(sql`1`),
        defaultProviderConnectionId: text('default_provider_connection_id').references(
            () => appProviderConnections.id,
            { onDelete: 'set null' },
        ),
        defaultModel: text('default_model'),
        capabilityDefaults: jsonText('capability_defaults', {}),
        searchConfig: jsonText('search_config', {}),
        imageConfig: jsonText('image_config', {}),
        onboardingCompletedAt: timestamp('onboarding_completed_at'),
        createdAt: createdAt(),
        updatedAt: updatedAt(),
    },
    (table) => [check('app_settings_singleton_check', sql`${table.id} = 1`)],
)

export const roomConfigs = sqliteTable(
    'room_configs',
    {
        roomId: text('room_id')
            .primaryKey()
            .references(() => rooms.id, { onDelete: 'cascade' }),
        instructions: text('instructions').notNull().default(''),
        providerMode: text('provider_mode', { enum: roomProviderModes })
            .notNull()
            .default('app_default'),
        providerConnectionId: text('provider_connection_id').references(
            () => appProviderConnections.id,
            { onDelete: 'set null' },
        ),
        roomMode: text('room_mode', { enum: roomModes }).notNull().default('coworker'),
        capabilityOverrides: jsonText('capability_overrides', {}),
        imageProvider: text('image_provider', { enum: imageProviderIds }),
        imageModel: text('image_model'),
        imageSecretId: text('image_secret_id').references(() => secrets.id, {
            onDelete: 'set null',
        }),
        cronTimezone: text('cron_timezone').notNull().default('UTC'),
        browserActionBudget: integer('browser_action_budget').notNull().default(50),
        createdAt: createdAt(),
        updatedAt: updatedAt(),
    },
    (table) => [
        index('room_configs_provider_connection_idx').on(table.providerConnectionId),
        enumCheck('room_configs_provider_mode_check', table.providerMode, roomProviderModes),
        enumCheck('room_configs_room_mode_check', table.roomMode, roomModes),
        check(
            'room_configs_image_provider_check',
            sql`${table.imageProvider} IS NULL OR ${table.imageProvider} IN (${sqlValueList(imageProviderIds)})`,
        ),
        check(
            'room_configs_browser_action_budget_check',
            sql`${table.browserActionBudget} BETWEEN 1 AND 200`,
        ),
    ],
)

export const roomMcpBindings = sqliteTable(
    'room_mcp_bindings',
    {
        roomId: text('room_id')
            .notNull()
            .references(() => rooms.id, { onDelete: 'cascade' }),
        mcpConnectionId: text('mcp_connection_id')
            .notNull()
            .references(() => appMcpConnections.id, { onDelete: 'cascade' }),
        allowedTools: jsonText('allowed_tools', []),
        enabled: integer('enabled', { mode: 'boolean' })
            .notNull()
            .default(sql`1`),
        createdAt: createdAt(),
        updatedAt: updatedAt(),
    },
    (table) => [
        primaryKey({
            name: 'room_mcp_bindings_pk',
            columns: [table.roomId, table.mcpConnectionId],
        }),
        index('room_mcp_bindings_connection_idx').on(table.mcpConnectionId),
    ],
)

export const roomSecrets = sqliteTable(
    'room_secrets',
    {
        id: text('id').primaryKey(),
        roomId: text('room_id')
            .notNull()
            .references(() => rooms.id, { onDelete: 'cascade' }),
        secretId: text('secret_id')
            .notNull()
            .references(() => secrets.id, { onDelete: 'cascade' }),
        label: text('label').notNull(),
        envKey: text('env_key').notNull(),
        purpose: text('purpose', { enum: roomSecretPurposes }).notNull(),
        provider: text('provider'),
        createdByUserId: text('created_by_user_id').references(() => users.id, {
            onDelete: 'set null',
        }),
        createdAt: createdAt(),
        updatedAt: updatedAt(),
    },
    (table) => [
        uniqueIndex('room_secrets_room_env_unique').on(table.roomId, table.envKey),
        index('room_secrets_room_id_idx').on(table.roomId),
        enumCheck('room_secrets_purpose_check', table.purpose, roomSecretPurposes),
    ],
)

export const providerValidationAttempts = sqliteTable(
    'provider_validation_attempts',
    {
        id: text('id').primaryKey(),
        providerConnectionId: text('provider_connection_id').references(
            () => appProviderConnections.id,
            { onDelete: 'set null' },
        ),
        roomId: text('room_id').references(() => rooms.id, { onDelete: 'set null' }),
        provider: text('provider').notNull(),
        authMode: text('auth_mode', { enum: providerAuthModes }).notNull(),
        api: text('api', { enum: providerApis }).notNull(),
        baseUrl: text('base_url'),
        model: text('model').notNull(),
        status: text('status', { enum: connectionStatuses }).notNull(),
        message: text('message').notNull(),
        startedAt: timestamp('started_at').notNull(),
        completedAt: timestamp('completed_at').notNull(),
    },
    (table) => [
        index('provider_validation_attempts_provider_idx').on(table.provider, table.completedAt),
        enumCheck(
            'provider_validation_attempts_auth_mode_check',
            table.authMode,
            providerAuthModes,
        ),
        enumCheck('provider_validation_attempts_api_check', table.api, providerApis),
        enumCheck('provider_validation_attempts_status_check', table.status, connectionStatuses),
    ],
)

export const roomCronJobs = sqliteTable(
    'room_cron_jobs',
    {
        id: text('id').primaryKey(),
        roomId: text('room_id')
            .notNull()
            .references(() => rooms.id, { onDelete: 'cascade' }),
        name: text('name').notNull(),
        message: text('message').notNull(),
        enabled: integer('enabled', { mode: 'boolean' })
            .notNull()
            .default(sql`1`),
        everyMinutes: integer('every_minutes').notNull(),
        schedule: jsonText('schedule', { type: 'daily', times: ['09:00'] }),
        timezone: text('timezone').notNull().default('UTC'),
        sessionTarget: text('session_target', { enum: ['isolated', 'selected'] })
            .notNull()
            .default('isolated'),
        targetThreadKey: text('target_thread_key'),
        nextRunAt: timestamp('next_run_at'),
        runningAt: timestamp('running_at'),
        lockedUntil: timestamp('locked_until'),
        lockToken: text('lock_token'),
        heartbeatAt: timestamp('heartbeat_at'),
        lastRenewedAt: timestamp('last_renewed_at'),
        runBudgetMs: integer('run_budget_ms'),
        recoveryReason: text('recovery_reason'),
        lastRunAt: timestamp('last_run_at'),
        lastRunStatus: text('last_run_status'),
        lastError: text('last_error'),
        lastDurationMs: integer('last_duration_ms'),
        provider: text('provider'),
        model: text('model'),
        configVersion: integer('config_version'),
        createdAt: createdAt(),
        updatedAt: updatedAt(),
    },
    (table) => [
        index('room_cron_jobs_room_id_idx').on(table.roomId),
        index('room_cron_jobs_due_idx').on(table.enabled, table.nextRunAt),
        check('room_cron_jobs_every_minutes_check', sql`${table.everyMinutes} > 0`),
        enumCheck('room_cron_jobs_session_target_check', table.sessionTarget, [
            'isolated',
            'selected',
        ]),
    ],
)

export const roomCronRuns = sqliteTable(
    'room_cron_runs',
    {
        id: text('id').primaryKey(),
        roomId: text('room_id')
            .notNull()
            .references(() => rooms.id, { onDelete: 'cascade' }),
        jobId: text('job_id').references(() => roomCronJobs.id, { onDelete: 'set null' }),
        jobName: text('job_name'),
        attempt: integer('attempt').notNull().default(1),
        status: text('status', { enum: cronRunStatuses }).notNull(),
        summary: text('summary'),
        error: text('error'),
        sessionKey: text('session_key'),
        sessionId: text('session_id'),
        provider: text('provider'),
        model: text('model'),
        configVersion: integer('config_version'),
        startedAt: timestamp('started_at').notNull(),
        finishedAt: timestamp('finished_at'),
        durationMs: integer('duration_ms'),
        nextRunAt: timestamp('next_run_at'),
    },
    (table) => [
        index('room_cron_runs_room_id_started_at_idx').on(table.roomId, table.startedAt),
        index('room_cron_runs_job_id_started_at_idx').on(table.jobId, table.startedAt),
        check('room_cron_runs_attempt_check', sql`${table.attempt} > 0`),
        enumCheck('room_cron_runs_status_check', table.status, cronRunStatuses),
    ],
)

export const usageEvents = sqliteTable(
    'usage_events',
    {
        id: text('id').primaryKey(),
        roomId: text('room_id').references(() => rooms.id, { onDelete: 'cascade' }),
        sessionKey: text('session_key'),
        runId: text('run_id'),
        jobId: text('job_id').references(() => roomCronJobs.id, { onDelete: 'set null' }),
        kind: text('kind', { enum: usageEventKinds }).notNull(),
        provider: text('provider'),
        model: text('model'),
        toolName: text('tool_name'),
        inputTokens: integer('input_tokens'),
        outputTokens: integer('output_tokens'),
        cachedTokens: integer('cached_tokens'),
        reasoningTokens: integer('reasoning_tokens'),
        totalTokens: integer('total_tokens'),
        durationMs: integer('duration_ms'),
        activeDurationMs: integer('active_duration_ms'),
        idleDurationMs: integer('idle_duration_ms'),
        estimatedCostUsd: text('estimated_cost_usd'),
        metadata: jsonText('metadata', {}),
        createdAt: createdAt(),
    },
    (table) => [
        index('usage_events_room_created_idx').on(table.roomId, table.createdAt),
        index('usage_events_kind_created_idx').on(table.kind, table.createdAt),
        index('usage_events_session_run_idx').on(table.roomId, table.sessionKey, table.runId),
        enumCheck('usage_events_kind_check', table.kind, usageEventKinds),
    ],
)

export const roomSessionBadgeState = sqliteTable(
    'room_session_badge_state',
    {
        userId: text('user_id')
            .notNull()
            .references(() => users.id, { onDelete: 'cascade' }),
        roomId: text('room_id')
            .notNull()
            .references(() => rooms.id, { onDelete: 'cascade' }),
        sessionKey: text('session_key').notNull(),
        completedClearedAt: timestamp('completed_cleared_at').notNull(),
        updatedAt: updatedAt(),
    },
    (table) => [
        primaryKey({
            name: 'room_session_badge_state_pk',
            columns: [table.userId, table.roomId, table.sessionKey],
        }),
        index('room_session_badge_state_room_user_idx').on(table.roomId, table.userId),
    ],
)

export const appGithubManifestSessions = sqliteTable(
    'app_github_manifest_sessions',
    {
        stateHash: text('state_hash').primaryKey(),
        actorUserId: text('actor_user_id').references(() => users.id, { onDelete: 'set null' }),
        publicOrigin: text('public_origin').notNull(),
        targetOwner: text('target_owner'),
        status: text('status', {
            enum: ['pending', 'completed', 'expired', 'failed'],
        })
            .notNull()
            .default('pending'),
        expiresAt: timestamp('expires_at').notNull(),
        createdAt: createdAt(),
        updatedAt: updatedAt(),
    },
    (table) => [
        index('app_github_manifest_sessions_expires_at_idx').on(table.expiresAt),
        enumCheck('app_github_manifest_sessions_status_check', table.status, [
            'pending',
            'completed',
            'expired',
            'failed',
        ]),
    ],
)

export const appGithubApps = sqliteTable(
    'app_github_apps',
    {
        id: integer('id', { mode: 'boolean' })
            .primaryKey()
            .notNull()
            .default(sql`1`),
        appId: text('app_id').notNull(),
        slug: text('slug').notNull(),
        name: text('name').notNull(),
        clientId: text('client_id').notNull(),
        clientSecretSecretId: text('client_secret_secret_id')
            .notNull()
            .references(() => secrets.id, { onDelete: 'restrict' }),
        privateKeySecretId: text('private_key_secret_id')
            .notNull()
            .references(() => secrets.id, { onDelete: 'restrict' }),
        webhookSecretSecretId: text('webhook_secret_secret_id').references(() => secrets.id, {
            onDelete: 'set null',
        }),
        htmlUrl: text('html_url'),
        status: text('status', { enum: connectionStatuses }).notNull().default('ready'),
        validationMessage: text('validation_message'),
        lastValidatedAt: timestamp('last_validated_at'),
        createdByUserId: text('created_by_user_id').references(() => users.id, {
            onDelete: 'set null',
        }),
        createdAt: createdAt(),
        updatedAt: updatedAt(),
    },
    (table) => [
        check('app_github_apps_singleton_check', sql`${table.id} = 1`),
        enumCheck('app_github_apps_status_check', table.status, connectionStatuses),
    ],
)

export const appGithubUserAuthSessions = sqliteTable(
    'app_github_user_auth_sessions',
    {
        stateHash: text('state_hash').primaryKey(),
        actorUserId: text('actor_user_id').references(() => users.id, { onDelete: 'set null' }),
        publicOrigin: text('public_origin').notNull(),
        codeVerifier: text('code_verifier').notNull(),
        status: text('status', {
            enum: ['pending', 'completed', 'expired', 'failed'],
        })
            .notNull()
            .default('pending'),
        expiresAt: timestamp('expires_at').notNull(),
        createdAt: createdAt(),
        updatedAt: updatedAt(),
    },
    (table) => [
        index('app_github_user_auth_sessions_expires_at_idx').on(table.expiresAt),
        enumCheck('app_github_user_auth_sessions_status_check', table.status, [
            'pending',
            'completed',
            'expired',
            'failed',
        ]),
    ],
)

export const appGithubUserConnections = sqliteTable(
    'app_github_user_connections',
    {
        id: integer('id', { mode: 'boolean' })
            .primaryKey()
            .notNull()
            .default(sql`1`),
        githubUserId: text('github_user_id').notNull(),
        login: text('login').notNull(),
        name: text('name'),
        avatarUrl: text('avatar_url'),
        htmlUrl: text('html_url'),
        tokenType: text('token_type').notNull().default('bearer'),
        accessTokenSecretId: text('access_token_secret_id')
            .notNull()
            .references(() => secrets.id, { onDelete: 'restrict' }),
        accessTokenExpiresAt: timestamp('access_token_expires_at'),
        refreshTokenSecretId: text('refresh_token_secret_id').references(() => secrets.id, {
            onDelete: 'set null',
        }),
        refreshTokenExpiresAt: timestamp('refresh_token_expires_at'),
        createdByUserId: text('created_by_user_id').references(() => users.id, {
            onDelete: 'set null',
        }),
        lastAuthorizedAt: timestamp('last_authorized_at').notNull(),
        createdAt: createdAt(),
        updatedAt: updatedAt(),
    },
    (table) => [
        check('app_github_user_connections_singleton_check', sql`${table.id} = 1`),
        index('app_github_user_connections_login_idx').on(table.login),
    ],
)

export const appGithubInstallations = sqliteTable(
    'app_github_installations',
    {
        installationId: text('installation_id').primaryKey(),
        accountLogin: text('account_login').notNull(),
        accountType: text('account_type').notNull(),
        targetType: text('target_type'),
        htmlUrl: text('html_url'),
        repositorySelection: text('repository_selection').notNull().default('selected'),
        permissions: jsonText('permissions', {}),
        suspendedAt: timestamp('suspended_at'),
        status: text('status', { enum: connectionStatuses }).notNull().default('ready'),
        lastSyncedAt: timestamp('last_synced_at').notNull(),
        createdAt: createdAt(),
        updatedAt: updatedAt(),
    },
    (table) => [
        index('app_github_installations_account_idx').on(table.accountLogin),
        enumCheck('app_github_installations_status_check', table.status, connectionStatuses),
    ],
)

export const roomGithubBindings = sqliteTable(
    'room_github_bindings',
    {
        roomId: text('room_id')
            .primaryKey()
            .references(() => rooms.id, { onDelete: 'cascade' }),
        installationId: text('installation_id')
            .notNull()
            .references(() => appGithubInstallations.installationId, { onDelete: 'restrict' }),
        repositories: jsonText('repositories', []),
        enabled: integer('enabled', { mode: 'boolean' })
            .notNull()
            .default(sql`1`),
        createdByUserId: text('created_by_user_id').references(() => users.id, {
            onDelete: 'set null',
        }),
        createdAt: createdAt(),
        updatedAt: updatedAt(),
    },
    (table) => [index('room_github_bindings_installation_idx').on(table.installationId)],
)

export const roomOnboarding = sqliteTable(
    'room_onboarding',
    {
        roomId: text('room_id')
            .primaryKey()
            .references(() => rooms.id, { onDelete: 'cascade' }),
        status: text('status', { enum: roomOnboardingStatuses }).notNull(),
        sessionKey: text('session_key'),
        createdAt: createdAt(),
        updatedAt: updatedAt(),
        completedAt: timestamp('completed_at'),
        deferredAt: timestamp('deferred_at'),
    },
    (table) => [
        index('room_onboarding_status_idx').on(table.status),
        enumCheck('room_onboarding_status_check', table.status, roomOnboardingStatuses),
    ],
)

export const sessionComposerDrafts = sqliteTable(
    'session_composer_drafts',
    {
        authSessionId: text('auth_session_id')
            .notNull()
            .references(() => sessions.id, { onDelete: 'cascade' }),
        roomId: text('room_id')
            .notNull()
            .references(() => rooms.id, { onDelete: 'cascade' }),
        sessionKey: text('session_key').notNull(),
        draft: text('draft').notNull(),
        createdAt: createdAt(),
        updatedAt: updatedAt(),
    },
    (table) => [
        primaryKey({
            name: 'session_composer_drafts_pk',
            columns: [table.authSessionId, table.roomId, table.sessionKey],
        }),
        index('session_composer_drafts_room_session_idx').on(table.roomId, table.sessionKey),
        check('session_composer_drafts_length_check', sql`length(${table.draft}) <= 20000`),
    ],
)
