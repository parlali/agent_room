import type {
    AppMcpConnectionRecord,
    AppProviderConnectionRecord,
    AppSettingsRecord,
    ArtifactIndexRecord,
    AuditEventRecord,
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
    SecretRecord,
    SessionRecord,
    UserRecord,
    UserRole,
} from '../../domain/types'

type DbRow = Record<string, unknown>

export function asJsonValue(value: unknown): JsonValue {
    return value as JsonValue
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
        lastSeenAt: (row.last_seen_at as Date | null) ?? null,
        revokedAt: (row.revoked_at as Date | null) ?? null,
        userAgent: (row.user_agent as string | null) ?? null,
        ipAddress: (row.ip_address as string | null) ?? null,
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
        port: (row.port as number | null) ?? null,
        pid: (row.pid as number | null) ?? null,
        configVersion: Number(row.config_version),
        tokenVersion: Number(row.token_version),
        healthStatus: row.health_status as HealthStatus,
        startedAt: (row.started_at as Date | null) ?? null,
        lastHealthAt: (row.last_health_at as Date | null) ?? null,
        lastError: (row.last_error as string | null) ?? null,
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
        baseUrl: (row.base_url as string | null) ?? null,
        defaultModel: String(row.default_model),
        fallbackModels: asJsonValue(row.fallback_models),
        credentialSecretId: (row.credential_secret_id as string | null) ?? null,
        status: row.status as AppProviderConnectionRecord['status'],
        validationMessage: (row.validation_message as string | null) ?? null,
        lastValidatedAt: (row.last_validated_at as Date | null) ?? null,
        createdByUserId: (row.created_by_user_id as string | null) ?? null,
        createdAt: row.created_at as Date,
        updatedAt: row.updated_at as Date,
    }
}

export function mapAppMcpConnection(row: DbRow): AppMcpConnectionRecord {
    return {
        id: String(row.id),
        name: String(row.name),
        serverKey: String(row.server_key),
        transport: row.transport as AppMcpConnectionRecord['transport'],
        command: (row.command as string | null) ?? null,
        args: asJsonValue(row.args),
        url: (row.url as string | null) ?? null,
        headers: asJsonValue(row.headers),
        authMode: row.auth_mode as AppMcpConnectionRecord['authMode'],
        credentialSecretId: (row.credential_secret_id as string | null) ?? null,
        allowedTools: asJsonValue(row.allowed_tools),
        status: row.status as AppMcpConnectionRecord['status'],
        validationMessage: (row.validation_message as string | null) ?? null,
        lastValidatedAt: (row.last_validated_at as Date | null) ?? null,
        createdByUserId: (row.created_by_user_id as string | null) ?? null,
        createdAt: row.created_at as Date,
        updatedAt: row.updated_at as Date,
    }
}

export function mapAppSettings(row: DbRow): AppSettingsRecord {
    return {
        id: Boolean(row.id),
        defaultProviderConnectionId: (row.default_provider_connection_id as string | null) ?? null,
        defaultModel: (row.default_model as string | null) ?? null,
        onboardingCompletedAt: (row.onboarding_completed_at as Date | null) ?? null,
        createdAt: row.created_at as Date,
        updatedAt: row.updated_at as Date,
    }
}

export function mapRoomConfig(row: DbRow): RoomConfigRecord {
    return {
        roomId: String(row.room_id),
        instructions: String(row.instructions),
        providerMode: row.provider_mode as RoomConfigRecord['providerMode'],
        providerConnectionId: (row.provider_connection_id as string | null) ?? null,
        provider: (row.provider as string | null) ?? null,
        providerApi: (row.provider_api as RoomConfigRecord['providerApi']) ?? null,
        providerBaseUrl: (row.provider_base_url as string | null) ?? null,
        providerModel: (row.provider_model as string | null) ?? null,
        providerSecretId: (row.provider_secret_id as string | null) ?? null,
        toolsProfile: row.tools_profile as RoomToolProfile,
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
        provider: (row.provider as string | null) ?? null,
        createdByUserId: (row.created_by_user_id as string | null) ?? null,
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
        actorUserId: (row.actor_user_id as string | null) ?? null,
        roomId: (row.room_id as string | null) ?? null,
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
        targetThreadKey: (row.target_thread_key as string | null) ?? null,
        nextRunAt: (row.next_run_at as Date | null) ?? null,
        runningAt: (row.running_at as Date | null) ?? null,
        lockedUntil: (row.locked_until as Date | null) ?? null,
        lockToken: (row.lock_token as string | null) ?? null,
        lastRunAt: (row.last_run_at as Date | null) ?? null,
        lastRunStatus: (row.last_run_status as string | null) ?? null,
        lastError: (row.last_error as string | null) ?? null,
        lastDurationMs:
            row.last_duration_ms === null || row.last_duration_ms === undefined
                ? null
                : Number(row.last_duration_ms),
        provider: (row.provider as string | null) ?? null,
        model: (row.model as string | null) ?? null,
        configVersion:
            row.config_version === null || row.config_version === undefined
                ? null
                : Number(row.config_version),
        createdAt: row.created_at as Date,
        updatedAt: row.updated_at as Date,
    }
}

export function mapRoomCronRun(row: DbRow): RoomCronRunRecord {
    return {
        id: String(row.id),
        roomId: String(row.room_id),
        jobId: (row.job_id as string | null) ?? null,
        jobName: (row.job_name as string | null) ?? null,
        attempt: Number(row.attempt),
        status: row.status as RoomCronRunRecord['status'],
        summary: (row.summary as string | null) ?? null,
        error: (row.error as string | null) ?? null,
        sessionKey: (row.session_key as string | null) ?? null,
        sessionId: (row.session_id as string | null) ?? null,
        provider: (row.provider as string | null) ?? null,
        model: (row.model as string | null) ?? null,
        configVersion:
            row.config_version === null || row.config_version === undefined
                ? null
                : Number(row.config_version),
        startedAt: row.started_at as Date,
        finishedAt: (row.finished_at as Date | null) ?? null,
        durationMs:
            row.duration_ms === null || row.duration_ms === undefined
                ? null
                : Number(row.duration_ms),
        nextRunAt: (row.next_run_at as Date | null) ?? null,
    }
}
