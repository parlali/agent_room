import type {
    AppGitHubAppRecord,
    AppGitHubInstallationRecord,
    AppGitHubManifestSessionRecord,
    AppGitHubUserAuthSessionRecord,
    AppGitHubUserConnectionRecord,
    AppMcpConnectionRecord,
    AppProviderConnectionRecord,
    AppSettingsRecord,
    ArtifactIndexRecord,
    AuditEventRecord,
    ConnectionStatus,
    HealthStatus,
    JsonValue,
    RoomConfigRecord,
    RoomCronJobRecord,
    RoomCronRunRecord,
    RoomDesiredState,
    RoomGitHubBindingRecord,
    RoomMcpBindingRecord,
    RoomOnboardingRecord,
    RoomOnboardingStatus,
    RoomRecord,
    RoomRuntimeMetadataRecord,
    RoomSecretRecord,
    RoomStatus,
    SecretRecord,
    SessionComposerDraftRecord,
    SessionRecord,
    UsageEventKind,
    UsageEventRecord,
    UserRecord,
    UserRole,
} from '#/domain/domain-types'

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

function bufferValue(value: unknown): Buffer {
    if (Buffer.isBuffer(value)) {
        return value
    }
    if (value instanceof Uint8Array) {
        return Buffer.from(value)
    }
    throw new Error('Expected database blob value')
}

function mapConnectionValidationFields(row: DbRow) {
    return {
        credentialSecretId: nullableValue<string>(row.credentialSecretId),
        status: row.status as ConnectionStatus,
        validationMessage: nullableValue<string>(row.validationMessage),
        lastValidatedAt: nullableValue<Date>(row.lastValidatedAt),
        createdByUserId: nullableValue<string>(row.createdByUserId),
        createdAt: row.createdAt as Date,
        updatedAt: row.updatedAt as Date,
    }
}

export function mapUser(row: DbRow): UserRecord {
    return {
        id: String(row.id),
        email: String(row.email),
        passwordHash: String(row.passwordHash),
        role: row.role as UserRole,
        createdAt: row.createdAt as Date,
        updatedAt: row.updatedAt as Date,
    }
}

export function mapSession(row: DbRow): SessionRecord {
    return {
        id: String(row.id),
        userId: String(row.userId),
        tokenHash: String(row.tokenHash),
        expiresAt: row.expiresAt as Date,
        createdAt: row.createdAt as Date,
        lastSeenAt: nullableValue<Date>(row.lastSeenAt),
        revokedAt: nullableValue<Date>(row.revokedAt),
        userAgent: nullableValue<string>(row.userAgent),
        ipAddress: nullableValue<string>(row.ipAddress),
    }
}

export function mapSessionComposerDraft(row: DbRow): SessionComposerDraftRecord {
    return {
        authSessionId: String(row.authSessionId),
        roomId: String(row.roomId),
        sessionKey: String(row.sessionKey),
        draft: String(row.draft),
        createdAt: row.createdAt as Date,
        updatedAt: row.updatedAt as Date,
    }
}

export function mapRoom(row: DbRow): RoomRecord {
    return {
        id: String(row.id),
        slug: String(row.slug),
        displayName: String(row.displayName),
        status: row.status as RoomStatus,
        desiredState: row.desiredState as RoomDesiredState,
        createdByUserId: String(row.createdByUserId),
        createdAt: row.createdAt as Date,
        updatedAt: row.updatedAt as Date,
    }
}

export function mapRoomOnboarding(row: DbRow): RoomOnboardingRecord {
    return {
        roomId: String(row.roomId),
        status: row.status as RoomOnboardingStatus,
        sessionKey: nullableValue<string>(row.sessionKey),
        createdAt: row.createdAt as Date,
        updatedAt: row.updatedAt as Date,
        completedAt: nullableValue<Date>(row.completedAt),
        deferredAt: nullableValue<Date>(row.deferredAt),
    }
}

export function mapRuntimeMetadata(row: DbRow): RoomRuntimeMetadataRecord {
    return {
        roomId: String(row.roomId),
        port: nullableValue<number>(row.port),
        pid: nullableValue<number>(row.pid),
        sandboxUid: nullableValue<number>(row.sandboxUid),
        sandboxGid: nullableValue<number>(row.sandboxGid),
        sandboxUserName: nullableValue<string>(row.sandboxUserName),
        sandboxGroupName: nullableValue<string>(row.sandboxGroupName),
        configVersion: Number(row.configVersion),
        tokenVersion: Number(row.tokenVersion),
        healthStatus: row.healthStatus as HealthStatus,
        startedAt: nullableValue<Date>(row.startedAt),
        lastHealthAt: nullableValue<Date>(row.lastHealthAt),
        lastError: nullableValue<string>(row.lastError),
        updatedAt: row.updatedAt as Date,
    }
}

export function mapSecret(row: DbRow): SecretRecord {
    return {
        id: String(row.id),
        keyName: String(row.keyName),
        cipherText: bufferValue(row.cipherText),
        nonce: bufferValue(row.nonce),
        authTag: bufferValue(row.authTag),
        keyVersion: Number(row.keyVersion),
        createdAt: row.createdAt as Date,
        updatedAt: row.updatedAt as Date,
    }
}

export function mapAppProviderConnection(row: DbRow): AppProviderConnectionRecord {
    return {
        id: String(row.id),
        label: String(row.label),
        provider: String(row.provider),
        authMode: row.authMode as AppProviderConnectionRecord['authMode'],
        api: row.api as AppProviderConnectionRecord['api'],
        baseUrl: nullableValue<string>(row.baseUrl),
        defaultModel: String(row.defaultModel),
        fallbackModels: asJsonValue(row.fallbackModels),
        ...mapConnectionValidationFields(row),
    }
}

export function mapAppMcpConnection(row: DbRow): AppMcpConnectionRecord {
    return {
        id: String(row.id),
        name: String(row.name),
        serverKey: String(row.serverKey),
        transport: row.transport as AppMcpConnectionRecord['transport'],
        command: nullableValue<string>(row.command),
        args: asJsonValue(row.args),
        url: nullableValue<string>(row.url),
        headers: asJsonValue(row.headers),
        authMode: row.authMode as AppMcpConnectionRecord['authMode'],
        allowedTools: asJsonValue(row.allowedTools),
        ...mapConnectionValidationFields(row),
    }
}

export function mapAppSettings(row: DbRow): AppSettingsRecord {
    return {
        id: Boolean(row.id),
        defaultProviderConnectionId: nullableValue<string>(row.defaultProviderConnectionId),
        defaultModel: nullableValue<string>(row.defaultModel),
        capabilityDefaults: asJsonValue(row.capabilityDefaults ?? {}),
        searchConfig: asJsonValue(row.searchConfig ?? {}),
        imageConfig: asJsonValue(row.imageConfig ?? {}),
        onboardingCompletedAt: nullableValue<Date>(row.onboardingCompletedAt),
        createdAt: row.createdAt as Date,
        updatedAt: row.updatedAt as Date,
    }
}

export function mapAppGitHubManifestSession(row: DbRow): AppGitHubManifestSessionRecord {
    return {
        stateHash: String(row.stateHash),
        actorUserId: nullableValue<string>(row.actorUserId),
        publicOrigin: String(row.publicOrigin),
        targetOwner: nullableValue<string>(row.targetOwner),
        status: row.status as AppGitHubManifestSessionRecord['status'],
        expiresAt: row.expiresAt as Date,
        createdAt: row.createdAt as Date,
        updatedAt: row.updatedAt as Date,
    }
}

export function mapAppGitHubApp(row: DbRow): AppGitHubAppRecord {
    return {
        id: Boolean(row.id),
        appId: String(row.appId),
        slug: String(row.slug),
        name: String(row.name),
        clientId: String(row.clientId),
        clientSecretSecretId: String(row.clientSecretSecretId),
        privateKeySecretId: String(row.privateKeySecretId),
        webhookSecretSecretId: nullableValue<string>(row.webhookSecretSecretId),
        htmlUrl: nullableValue<string>(row.htmlUrl),
        status: row.status as AppGitHubAppRecord['status'],
        validationMessage: nullableValue<string>(row.validationMessage),
        lastValidatedAt: nullableValue<Date>(row.lastValidatedAt),
        createdByUserId: nullableValue<string>(row.createdByUserId),
        createdAt: row.createdAt as Date,
        updatedAt: row.updatedAt as Date,
    }
}

export function mapAppGitHubUserAuthSession(row: DbRow): AppGitHubUserAuthSessionRecord {
    return {
        stateHash: String(row.stateHash),
        actorUserId: nullableValue<string>(row.actorUserId),
        publicOrigin: String(row.publicOrigin),
        codeVerifier: String(row.codeVerifier),
        status: row.status as AppGitHubUserAuthSessionRecord['status'],
        expiresAt: row.expiresAt as Date,
        createdAt: row.createdAt as Date,
        updatedAt: row.updatedAt as Date,
    }
}

export function mapAppGitHubUserConnection(row: DbRow): AppGitHubUserConnectionRecord {
    return {
        id: Boolean(row.id),
        githubUserId: String(row.githubUserId),
        login: String(row.login),
        name: nullableValue<string>(row.name),
        avatarUrl: nullableValue<string>(row.avatarUrl),
        htmlUrl: nullableValue<string>(row.htmlUrl),
        tokenType: String(row.tokenType),
        accessTokenSecretId: String(row.accessTokenSecretId),
        accessTokenExpiresAt: nullableValue<Date>(row.accessTokenExpiresAt),
        refreshTokenSecretId: nullableValue<string>(row.refreshTokenSecretId),
        refreshTokenExpiresAt: nullableValue<Date>(row.refreshTokenExpiresAt),
        createdByUserId: nullableValue<string>(row.createdByUserId),
        lastAuthorizedAt: row.lastAuthorizedAt as Date,
        createdAt: row.createdAt as Date,
        updatedAt: row.updatedAt as Date,
    }
}

export function mapAppGitHubInstallation(row: DbRow): AppGitHubInstallationRecord {
    return {
        installationId: String(row.installationId),
        accountLogin: String(row.accountLogin),
        accountType: String(row.accountType),
        targetType: nullableValue<string>(row.targetType),
        htmlUrl: nullableValue<string>(row.htmlUrl),
        repositorySelection: String(row.repositorySelection),
        permissions: asJsonValue(row.permissions ?? {}),
        suspendedAt: nullableValue<Date>(row.suspendedAt),
        status: row.status as AppGitHubInstallationRecord['status'],
        lastSyncedAt: row.lastSyncedAt as Date,
        createdAt: row.createdAt as Date,
        updatedAt: row.updatedAt as Date,
    }
}

export function mapRoomConfig(row: DbRow): RoomConfigRecord {
    return {
        roomId: String(row.roomId),
        instructions: String(row.instructions),
        providerMode: row.providerMode as RoomConfigRecord['providerMode'],
        providerConnectionId: nullableValue<string>(row.providerConnectionId),
        roomMode: row.roomMode as RoomConfigRecord['roomMode'],
        capabilityOverrides: asJsonValue(row.capabilityOverrides ?? {}),
        imageProvider: (row.imageProvider as RoomConfigRecord['imageProvider']) ?? null,
        imageModel: nullableValue<string>(row.imageModel),
        imageSecretId: nullableValue<string>(row.imageSecretId),
        cronTimezone: String(row.cronTimezone),
        browserActionBudget: Number(row.browserActionBudget),
        createdAt: row.createdAt as Date,
        updatedAt: row.updatedAt as Date,
    }
}

export function mapRoomGitHubBinding(row: DbRow): RoomGitHubBindingRecord {
    return {
        roomId: String(row.roomId),
        installationId: String(row.installationId),
        repositories: asJsonValue(row.repositories ?? []),
        enabled: Boolean(row.enabled),
        createdByUserId: nullableValue<string>(row.createdByUserId),
        createdAt: row.createdAt as Date,
        updatedAt: row.updatedAt as Date,
    }
}

export function mapRoomMcpBinding(row: DbRow): RoomMcpBindingRecord {
    return {
        roomId: String(row.roomId),
        mcpConnectionId: String(row.mcpConnectionId),
        allowedTools: asJsonValue(row.allowedTools),
        enabled: Boolean(row.enabled),
        createdAt: row.createdAt as Date,
        updatedAt: row.updatedAt as Date,
    }
}

export function mapRoomSecret(row: DbRow): RoomSecretRecord {
    return {
        id: String(row.id),
        roomId: String(row.roomId),
        secretId: String(row.secretId),
        label: String(row.label),
        envKey: String(row.envKey),
        purpose: row.purpose as RoomSecretRecord['purpose'],
        provider: nullableValue<string>(row.provider),
        createdByUserId: nullableValue<string>(row.createdByUserId),
        createdAt: row.createdAt as Date,
        updatedAt: row.updatedAt as Date,
    }
}

export function mapArtifact(row: DbRow): ArtifactIndexRecord {
    return {
        id: String(row.id),
        roomId: String(row.roomId),
        artifactId: String(row.artifactId),
        kind: row.kind as ArtifactIndexRecord['kind'],
        sha256: String(row.sha256),
        byteLength: Number(row.byteLength),
        mediaType: String(row.mediaType),
        manifestPath: String(row.manifestPath),
        source: asJsonValue(row.source),
        provenance: asJsonValue(row.provenance),
        createdBy: String(row.createdBy),
        createdAt: row.createdAt as Date,
    }
}

export function mapAudit(row: DbRow): AuditEventRecord {
    return {
        id: Number(row.id),
        actorUserId: nullableValue<string>(row.actorUserId),
        roomId: nullableValue<string>(row.roomId),
        action: String(row.action),
        payload: asJsonValue(row.payload),
        createdAt: row.createdAt as Date,
    }
}

export function mapRoomCronJob(row: DbRow): RoomCronJobRecord {
    return {
        id: String(row.id),
        roomId: String(row.roomId),
        name: String(row.name),
        message: String(row.message),
        enabled: Boolean(row.enabled),
        everyMinutes: Number(row.everyMinutes),
        schedule: asJsonValue(row.schedule),
        timezone: String(row.timezone),
        sessionTarget: row.sessionTarget === 'selected' ? 'selected' : 'isolated',
        targetThreadKey: nullableValue<string>(row.targetThreadKey),
        nextRunAt: nullableValue<Date>(row.nextRunAt),
        runningAt: nullableValue<Date>(row.runningAt),
        lockedUntil: nullableValue<Date>(row.lockedUntil),
        lockToken: nullableValue<string>(row.lockToken),
        heartbeatAt: nullableValue<Date>(row.heartbeatAt),
        lastRenewedAt: nullableValue<Date>(row.lastRenewedAt),
        runBudgetMs: nullableNumber(row.runBudgetMs),
        recoveryReason: nullableValue<string>(row.recoveryReason),
        lastRunAt: nullableValue<Date>(row.lastRunAt),
        lastRunStatus: nullableValue<string>(row.lastRunStatus),
        lastError: nullableValue<string>(row.lastError),
        lastDurationMs: nullableNumber(row.lastDurationMs),
        provider: nullableValue<string>(row.provider),
        model: nullableValue<string>(row.model),
        configVersion: nullableNumber(row.configVersion),
        createdAt: row.createdAt as Date,
        updatedAt: row.updatedAt as Date,
    }
}

export function mapRoomCronRun(row: DbRow): RoomCronRunRecord {
    return {
        id: String(row.id),
        roomId: String(row.roomId),
        jobId: nullableValue<string>(row.jobId),
        jobName: nullableValue<string>(row.jobName),
        attempt: Number(row.attempt),
        status: row.status as RoomCronRunRecord['status'],
        summary: nullableValue<string>(row.summary),
        error: nullableValue<string>(row.error),
        sessionKey: nullableValue<string>(row.sessionKey),
        sessionId: nullableValue<string>(row.sessionId),
        provider: nullableValue<string>(row.provider),
        model: nullableValue<string>(row.model),
        configVersion: nullableNumber(row.configVersion),
        startedAt: row.startedAt as Date,
        finishedAt: nullableValue<Date>(row.finishedAt),
        durationMs: nullableNumber(row.durationMs),
        nextRunAt: nullableValue<Date>(row.nextRunAt),
    }
}

export function mapUsageEvent(row: DbRow): UsageEventRecord {
    return {
        id: String(row.id),
        roomId: nullableValue<string>(row.roomId),
        sessionKey: nullableValue<string>(row.sessionKey),
        runId: nullableValue<string>(row.runId),
        jobId: nullableValue<string>(row.jobId),
        kind: row.kind as UsageEventKind,
        provider: nullableValue<string>(row.provider),
        model: nullableValue<string>(row.model),
        toolName: nullableValue<string>(row.toolName),
        inputTokens: nullableNumber(row.inputTokens),
        outputTokens: nullableNumber(row.outputTokens),
        cachedTokens: nullableNumber(row.cachedTokens),
        reasoningTokens: nullableNumber(row.reasoningTokens),
        totalTokens: nullableNumber(row.totalTokens),
        durationMs: nullableNumber(row.durationMs),
        activeDurationMs: nullableNumber(row.activeDurationMs),
        idleDurationMs: nullableNumber(row.idleDurationMs),
        estimatedCostUsd: nullableValue<string>(row.estimatedCostUsd),
        metadata: asJsonValue(row.metadata ?? {}),
        createdAt: row.createdAt as Date,
    }
}
