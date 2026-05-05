import type {
    AppMcpConnectionRecord,
    AppProviderConnectionRecord,
    AppSettingsRecord,
    ArtifactIndexRecord,
    AuditEventRecord,
    ConnectionStatus,
    HealthStatus,
    JsonValue,
    RoomDesiredState,
    RoomConfigRecord,
    RoomCronJobRecord,
    RoomCronRunRecord,
    RoomMcpBindingRecord,
    RoomRecord,
    RoomRuntimeMetadataRecord,
    RoomSecretRecord,
    RoomStatus,
    RoomToolProfile,
    UsageEventRecord,
    UsageEventKind,
    SecretRecord,
    SessionRecord,
    UserRecord,
    UserRole,
} from '../../domain/types'

type DbRow = Record<string, unknown>

export function asJsonValue(value: unknown): JsonValue {
    return value as JsonValue
}

function nullableValue<T>(value: unknown): T | null {
    return (value as T | null) ?? null
}

function nullableNumber(value: unknown): number | null {
    if (value === null || value === undefined) {
        return null
    }
    return Number(value)
}

function mapConnectionValidationFields(row: DbRow) {
    return {
        credentialSecretId: nullableValue<string>(row.credential_secret_id),
        status: row.status as ConnectionStatus,
        validationMessage: nullableValue<string>(row.validation_message),
        lastValidatedAt: nullableValue<Date>(row.last_validated_at),
        createdByUserId: nullableValue<string>(row.created_by_user_id),
        createdAt: row.created_at as Date,
        updatedAt: row.updated_at as Date,
    }
}

export function mapUser(row: DbRow): UserRecord {
    return {
        id: String(row.id),
        email: String(row.email),
        passwordHash: String(row.password_hash),
        role: row.role as UserRole,
        createdAt: row.created_at as Date,
        updatedAt: row.updated_at as Date,
    }
}

export function mapSession(row: DbRow): SessionRecord {
    return {
        id: String(row.id),
        userId: String(row.user_id),
        tokenHash: String(row.token_hash),
        expiresAt: row.expires_at as Date,
        createdAt: row.created_at as Date,
        lastSeenAt: nullableValue<Date>(row.last_seen_at),
        revokedAt: nullableValue<Date>(row.revoked_at),
        userAgent: nullableValue<string>(row.user_agent),
        ipAddress: nullableValue<string>(row.ip_address),
    }
}

export function mapRoom(row: DbRow): RoomRecord {
    return {
        id: String(row.id),
        slug: String(row.slug),
        displayName: String(row.display_name),
        status: row.status as RoomStatus,
        desiredState: row.desired_state as RoomDesiredState,
        createdByUserId: String(row.created_by_user_id),
        createdAt: row.created_at as Date,
        updatedAt: row.updated_at as Date,
    }
}

export function mapRuntimeMetadata(row: DbRow): RoomRuntimeMetadataRecord {
    return {
        roomId: String(row.room_id),
        port: nullableValue<number>(row.port),
        pid: nullableValue<number>(row.pid),
        configVersion: Number(row.config_version),
        tokenVersion: Number(row.token_version),
        healthStatus: row.health_status as HealthStatus,
        startedAt: nullableValue<Date>(row.started_at),
        lastHealthAt: nullableValue<Date>(row.last_health_at),
        lastError: nullableValue<string>(row.last_error),
        updatedAt: row.updated_at as Date,
    }
}

export function mapSecret(row: DbRow): SecretRecord {
    return {
        id: String(row.id),
        keyName: String(row.key_name),
        cipherText: row.cipher_text as Buffer,
        nonce: row.nonce as Buffer,
        authTag: row.auth_tag as Buffer,
        keyVersion: Number(row.key_version),
        createdAt: row.created_at as Date,
        updatedAt: row.updated_at as Date,
    }
}

export function mapAppProviderConnection(row: DbRow): AppProviderConnectionRecord {
    return {
        id: String(row.id),
        label: String(row.label),
        provider: String(row.provider),
        authMode:
            row.auth_mode === 'oauth'
                ? 'oauth'
                : ('api_key' satisfies AppProviderConnectionRecord['authMode']),
        api: row.api as AppProviderConnectionRecord['api'],
        baseUrl: nullableValue<string>(row.base_url),
        defaultModel: String(row.default_model),
        fallbackModels: asJsonValue(row.fallback_models),
        ...mapConnectionValidationFields(row),
    }
}

export function mapAppMcpConnection(row: DbRow): AppMcpConnectionRecord {
    return {
        id: String(row.id),
        name: String(row.name),
        serverKey: String(row.server_key),
        transport: row.transport as AppMcpConnectionRecord['transport'],
        command: nullableValue<string>(row.command),
        args: asJsonValue(row.args),
        url: nullableValue<string>(row.url),
        headers: asJsonValue(row.headers),
        authMode: row.auth_mode as AppMcpConnectionRecord['authMode'],
        allowedTools: asJsonValue(row.allowed_tools),
        ...mapConnectionValidationFields(row),
    }
}

export function mapAppSettings(row: DbRow): AppSettingsRecord {
    return {
        id: Boolean(row.id),
        defaultProviderConnectionId: nullableValue<string>(row.default_provider_connection_id),
        defaultModel: nullableValue<string>(row.default_model),
        capabilityDefaults: asJsonValue(row.capability_defaults ?? {}),
        searchConfig: asJsonValue(row.search_config ?? {}),
        imageConfig: asJsonValue(row.image_config ?? {}),
        onboardingCompletedAt: nullableValue<Date>(row.onboarding_completed_at),
        createdAt: row.created_at as Date,
        updatedAt: row.updated_at as Date,
    }
}

export function mapRoomConfig(row: DbRow): RoomConfigRecord {
    return {
        roomId: String(row.room_id),
        instructions: String(row.instructions),
        providerMode: row.provider_mode as RoomConfigRecord['providerMode'],
        providerConnectionId: nullableValue<string>(row.provider_connection_id),
        provider: nullableValue<string>(row.provider),
        providerApi: (row.provider_api as RoomConfigRecord['providerApi']) ?? null,
        providerBaseUrl: nullableValue<string>(row.provider_base_url),
        providerModel: nullableValue<string>(row.provider_model),
        providerSecretId: nullableValue<string>(row.provider_secret_id),
        toolsProfile: row.tools_profile as RoomToolProfile,
        capabilityOverrides: asJsonValue(row.capability_overrides ?? {}),
        imageProvider: (row.image_provider as RoomConfigRecord['imageProvider']) ?? null,
        imageModel: nullableValue<string>(row.image_model),
        imageSecretId: nullableValue<string>(row.image_secret_id),
        cronTimezone: String(row.cron_timezone),
        createdAt: row.created_at as Date,
        updatedAt: row.updated_at as Date,
    }
}

export function mapRoomMcpBinding(row: DbRow): RoomMcpBindingRecord {
    return {
        roomId: String(row.room_id),
        mcpConnectionId: String(row.mcp_connection_id),
        allowedTools: asJsonValue(row.allowed_tools),
        enabled: Boolean(row.enabled),
        createdAt: row.created_at as Date,
        updatedAt: row.updated_at as Date,
    }
}

export function mapRoomSecret(row: DbRow): RoomSecretRecord {
    return {
        id: String(row.id),
        roomId: String(row.room_id),
        secretId: String(row.secret_id),
        label: String(row.label),
        envKey: String(row.env_key),
        purpose: row.purpose as RoomSecretRecord['purpose'],
        provider: nullableValue<string>(row.provider),
        createdByUserId: nullableValue<string>(row.created_by_user_id),
        createdAt: row.created_at as Date,
        updatedAt: row.updated_at as Date,
    }
}

export function mapArtifact(row: DbRow): ArtifactIndexRecord {
    return {
        id: String(row.id),
        roomId: String(row.room_id),
        artifactId: String(row.artifact_id),
        kind: row.kind as ArtifactIndexRecord['kind'],
        sha256: String(row.sha256),
        byteLength: Number(row.byte_length),
        mediaType: String(row.media_type),
        manifestPath: String(row.manifest_path),
        source: asJsonValue(row.source),
        provenance: asJsonValue(row.provenance),
        createdBy: String(row.created_by),
        createdAt: row.created_at as Date,
    }
}

export function mapAudit(row: DbRow): AuditEventRecord {
    return {
        id: Number(row.id),
        actorUserId: nullableValue<string>(row.actor_user_id),
        roomId: nullableValue<string>(row.room_id),
        action: String(row.action),
        payload: asJsonValue(row.payload),
        createdAt: row.created_at as Date,
    }
}

export function mapRoomCronJob(row: DbRow): RoomCronJobRecord {
    return {
        id: String(row.id),
        roomId: String(row.room_id),
        name: String(row.name),
        message: String(row.message),
        enabled: Boolean(row.enabled),
        everyMinutes: Number(row.every_minutes),
        timezone: String(row.timezone),
        sessionTarget: row.session_target === 'selected' ? 'selected' : 'isolated',
        targetThreadKey: nullableValue<string>(row.target_thread_key),
        nextRunAt: nullableValue<Date>(row.next_run_at),
        runningAt: nullableValue<Date>(row.running_at),
        lockedUntil: nullableValue<Date>(row.locked_until),
        lockToken: nullableValue<string>(row.lock_token),
        heartbeatAt: nullableValue<Date>(row.heartbeat_at),
        lastRenewedAt: nullableValue<Date>(row.last_renewed_at),
        runBudgetMs: nullableNumber(row.run_budget_ms),
        recoveryReason: nullableValue<string>(row.recovery_reason),
        lastRunAt: nullableValue<Date>(row.last_run_at),
        lastRunStatus: nullableValue<string>(row.last_run_status),
        lastError: nullableValue<string>(row.last_error),
        lastDurationMs: nullableNumber(row.last_duration_ms),
        provider: nullableValue<string>(row.provider),
        model: nullableValue<string>(row.model),
        configVersion: nullableNumber(row.config_version),
        createdAt: row.created_at as Date,
        updatedAt: row.updated_at as Date,
    }
}

export function mapRoomCronRun(row: DbRow): RoomCronRunRecord {
    return {
        id: String(row.id),
        roomId: String(row.room_id),
        jobId: nullableValue<string>(row.job_id),
        jobName: nullableValue<string>(row.job_name),
        attempt: Number(row.attempt),
        status: row.status as RoomCronRunRecord['status'],
        summary: nullableValue<string>(row.summary),
        error: nullableValue<string>(row.error),
        sessionKey: nullableValue<string>(row.session_key),
        sessionId: nullableValue<string>(row.session_id),
        provider: nullableValue<string>(row.provider),
        model: nullableValue<string>(row.model),
        configVersion: nullableNumber(row.config_version),
        startedAt: row.started_at as Date,
        finishedAt: nullableValue<Date>(row.finished_at),
        durationMs: nullableNumber(row.duration_ms),
        nextRunAt: nullableValue<Date>(row.next_run_at),
    }
}

export function mapUsageEvent(row: DbRow): UsageEventRecord {
    return {
        id: String(row.id),
        roomId: nullableValue<string>(row.room_id),
        sessionKey: nullableValue<string>(row.session_key),
        runId: nullableValue<string>(row.run_id),
        jobId: nullableValue<string>(row.job_id),
        kind: row.kind as UsageEventKind,
        provider: nullableValue<string>(row.provider),
        model: nullableValue<string>(row.model),
        toolName: nullableValue<string>(row.tool_name),
        inputTokens: nullableNumber(row.input_tokens),
        outputTokens: nullableNumber(row.output_tokens),
        cachedTokens: nullableNumber(row.cached_tokens),
        reasoningTokens: nullableNumber(row.reasoning_tokens),
        totalTokens: nullableNumber(row.total_tokens),
        durationMs: nullableNumber(row.duration_ms),
        activeDurationMs: nullableNumber(row.active_duration_ms),
        idleDurationMs: nullableNumber(row.idle_duration_ms),
        estimatedCostUsd: nullableValue<string>(row.estimated_cost_usd),
        metadata: asJsonValue(row.metadata ?? {}),
        createdAt: row.created_at as Date,
    }
}
