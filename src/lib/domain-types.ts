export const roomStatuses = ['starting', 'running', 'stopped', 'degraded', 'failed'] as const
export const roomDesiredStates = ['running', 'stopped'] as const
export const userRoles = ['root', 'operator'] as const
export const healthStatuses = ['unknown', 'healthy', 'unhealthy'] as const
export const artifactKinds = ['attachment', 'artifact'] as const
export const connectionStatuses = ['unchecked', 'ready', 'invalid'] as const
export const providerApis = [
    'openai-responses',
    'openai-completions',
    'openai-codex-responses',
    'anthropic-messages',
    'google-generative-ai',
] as const
export const providerAuthModes = ['api_key', 'oauth'] as const
export const mcpTransports = ['stdio', 'http', 'streamable_http'] as const
export const mcpAuthModes = ['none', 'bearer'] as const
export const roomProviderModes = ['app_default', 'app_connection', 'room_secret'] as const
export const roomSecretPurposes = ['provider_api_key', 'generic', 'webhook'] as const
export const roomModes = ['programmer', 'coworker'] as const
export const cronRunStatuses = ['running', 'complete', 'failed', 'skipped'] as const
export const capabilityIds = [
    'web_search',
    'url_fetch',
    'documents',
    'spreadsheets',
    'presentations',
    'pdf',
    'images',
    'mcp',
    'shell_coding',
] as const
export const imageProviderIds = ['openai', 'gemini'] as const
export const usageEventKinds = [
    'run',
    'provider',
    'tool',
    'document_worker',
    'image',
    'job',
] as const

export type RoomStatus = (typeof roomStatuses)[number]
export type RoomDesiredState = (typeof roomDesiredStates)[number]
export type UserRole = (typeof userRoles)[number]
export type HealthStatus = (typeof healthStatuses)[number]
export type ArtifactKind = (typeof artifactKinds)[number]
export type ConnectionStatus = (typeof connectionStatuses)[number]
export type ProviderApi = (typeof providerApis)[number]
export type ProviderAuthMode = (typeof providerAuthModes)[number]
export type McpTransport = (typeof mcpTransports)[number]
export type McpAuthMode = (typeof mcpAuthModes)[number]
export type RoomProviderMode = (typeof roomProviderModes)[number]
export type RoomSecretPurpose = (typeof roomSecretPurposes)[number]
export type RoomMode = (typeof roomModes)[number]
export type CronRunStatus = (typeof cronRunStatuses)[number]
export type CapabilityId = (typeof capabilityIds)[number]
export type ImageProviderId = (typeof imageProviderIds)[number]
export type UsageEventKind = (typeof usageEventKinds)[number]

export type JsonPrimitive = string | number | boolean | null
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue }

export interface UserRecord {
    id: string
    email: string
    passwordHash: string
    role: UserRole
    createdAt: Date
    updatedAt: Date
}

export interface SessionRecord {
    id: string
    userId: string
    tokenHash: string
    expiresAt: Date
    createdAt: Date
    lastSeenAt: Date | null
    revokedAt: Date | null
    userAgent: string | null
    ipAddress: string | null
}

export interface RoomRecord {
    id: string
    slug: string
    displayName: string
    status: RoomStatus
    desiredState: RoomDesiredState
    createdByUserId: string
    createdAt: Date
    updatedAt: Date
}

export interface RoomRuntimeMetadataRecord {
    roomId: string
    port: number | null
    pid: number | null
    configVersion: number
    tokenVersion: number
    healthStatus: HealthStatus
    startedAt: Date | null
    lastHealthAt: Date | null
    lastError: string | null
    updatedAt: Date
}

export interface SecretRecord {
    id: string
    keyName: string
    cipherText: Buffer
    nonce: Buffer
    authTag: Buffer
    keyVersion: number
    createdAt: Date
    updatedAt: Date
}

export interface AppProviderConnectionRecord {
    id: string
    label: string
    provider: string
    authMode: ProviderAuthMode
    api: ProviderApi
    baseUrl: string | null
    defaultModel: string
    fallbackModels: JsonValue
    credentialSecretId: string | null
    status: ConnectionStatus
    validationMessage: string | null
    lastValidatedAt: Date | null
    createdByUserId: string | null
    createdAt: Date
    updatedAt: Date
}

export interface AppMcpConnectionRecord {
    id: string
    name: string
    serverKey: string
    transport: McpTransport
    command: string | null
    args: JsonValue
    url: string | null
    headers: JsonValue
    authMode: McpAuthMode
    credentialSecretId: string | null
    allowedTools: JsonValue
    status: ConnectionStatus
    validationMessage: string | null
    lastValidatedAt: Date | null
    createdByUserId: string | null
    createdAt: Date
    updatedAt: Date
}

export interface AppSettingsRecord {
    id: boolean
    defaultProviderConnectionId: string | null
    defaultModel: string | null
    capabilityDefaults: JsonValue
    searchConfig: JsonValue
    imageConfig: JsonValue
    onboardingCompletedAt: Date | null
    createdAt: Date
    updatedAt: Date
}

export interface AppGitHubManifestSessionRecord {
    stateHash: string
    actorUserId: string | null
    publicOrigin: string
    targetOwner: string | null
    status: 'pending' | 'completed' | 'expired' | 'failed'
    expiresAt: Date
    createdAt: Date
    updatedAt: Date
}

export interface AppGitHubUserAuthSessionRecord {
    stateHash: string
    actorUserId: string | null
    publicOrigin: string
    codeVerifier: string
    status: 'pending' | 'completed' | 'expired' | 'failed'
    expiresAt: Date
    createdAt: Date
    updatedAt: Date
}

export interface AppGitHubAppRecord {
    id: boolean
    appId: string
    slug: string
    name: string
    clientId: string
    clientSecretSecretId: string
    privateKeySecretId: string
    webhookSecretSecretId: string | null
    htmlUrl: string | null
    status: ConnectionStatus
    validationMessage: string | null
    lastValidatedAt: Date | null
    createdByUserId: string | null
    createdAt: Date
    updatedAt: Date
}

export interface AppGitHubUserConnectionRecord {
    id: boolean
    githubUserId: string
    login: string
    name: string | null
    avatarUrl: string | null
    htmlUrl: string | null
    tokenType: string
    accessTokenSecretId: string
    accessTokenExpiresAt: Date | null
    refreshTokenSecretId: string | null
    refreshTokenExpiresAt: Date | null
    createdByUserId: string | null
    lastAuthorizedAt: Date
    createdAt: Date
    updatedAt: Date
}

export interface AppGitHubInstallationRecord {
    installationId: string
    accountLogin: string
    accountType: string
    targetType: string | null
    htmlUrl: string | null
    repositorySelection: string
    permissions: JsonValue
    suspendedAt: Date | null
    status: ConnectionStatus
    lastSyncedAt: Date
    createdAt: Date
    updatedAt: Date
}

export interface RoomConfigRecord {
    roomId: string
    instructions: string
    providerMode: RoomProviderMode
    providerConnectionId: string | null
    provider: string | null
    providerApi: ProviderApi | null
    providerBaseUrl: string | null
    providerModel: string | null
    providerSecretId: string | null
    roomMode: RoomMode
    capabilityOverrides: JsonValue
    imageProvider: ImageProviderId | null
    imageModel: string | null
    imageSecretId: string | null
    cronTimezone: string
    createdAt: Date
    updatedAt: Date
}

export interface RoomGitHubBindingRecord {
    roomId: string
    installationId: string
    repositories: JsonValue
    enabled: boolean
    createdByUserId: string | null
    createdAt: Date
    updatedAt: Date
}

export interface RoomMcpBindingRecord {
    roomId: string
    mcpConnectionId: string
    allowedTools: JsonValue
    enabled: boolean
    createdAt: Date
    updatedAt: Date
}

export interface RoomSecretRecord {
    id: string
    roomId: string
    secretId: string
    label: string
    envKey: string
    purpose: RoomSecretPurpose
    provider: string | null
    createdByUserId: string | null
    createdAt: Date
    updatedAt: Date
}

export interface ArtifactIndexRecord {
    id: string
    roomId: string
    artifactId: string
    kind: ArtifactKind
    sha256: string
    byteLength: number
    mediaType: string
    manifestPath: string
    source: JsonValue
    provenance: JsonValue
    createdBy: string
    createdAt: Date
}

export interface AuditEventRecord {
    id: number
    actorUserId: string | null
    roomId: string | null
    action: string
    payload: JsonValue
    createdAt: Date
}

export interface RoomCronJobRecord {
    id: string
    roomId: string
    name: string
    message: string
    enabled: boolean
    everyMinutes: number
    schedule: JsonValue
    timezone: string
    sessionTarget: 'isolated' | 'selected'
    targetThreadKey: string | null
    nextRunAt: Date | null
    runningAt: Date | null
    lockedUntil: Date | null
    lockToken: string | null
    heartbeatAt: Date | null
    lastRenewedAt: Date | null
    runBudgetMs: number | null
    recoveryReason: string | null
    lastRunAt: Date | null
    lastRunStatus: string | null
    lastError: string | null
    lastDurationMs: number | null
    provider: string | null
    model: string | null
    configVersion: number | null
    createdAt: Date
    updatedAt: Date
}

export interface RoomCronRunRecord {
    id: string
    roomId: string
    jobId: string | null
    jobName: string | null
    attempt: number
    status: CronRunStatus
    summary: string | null
    error: string | null
    sessionKey: string | null
    sessionId: string | null
    provider: string | null
    model: string | null
    configVersion: number | null
    startedAt: Date
    finishedAt: Date | null
    durationMs: number | null
    nextRunAt: Date | null
}

export interface UsageEventRecord {
    id: string
    roomId: string | null
    sessionKey: string | null
    runId: string | null
    jobId: string | null
    kind: UsageEventKind
    provider: string | null
    model: string | null
    toolName: string | null
    inputTokens: number | null
    outputTokens: number | null
    cachedTokens: number | null
    reasoningTokens: number | null
    totalTokens: number | null
    durationMs: number | null
    activeDurationMs: number | null
    idleDurationMs: number | null
    estimatedCostUsd: string | null
    metadata: JsonValue
    createdAt: Date
}

export interface RunBudgetConfig {
    manualTurnMs: number
    scheduledTurnMs: number
    deepWorkTurnMs: number
    subagentTurnMs: number
    maintenanceTurnMs: number
    idleTimeoutMs: number
    providerIdleTimeoutMs: number
    shellCommandMs: number
    webFetchMs: number
    documentWorkerMs: number
    imageGenerationMs: number
    mcpToolMs: number
    shortCommandWaitMs: number
}

export interface CapabilityConfig {
    webSearch: boolean
    urlFetch: boolean
    documents: boolean
    spreadsheets: boolean
    presentations: boolean
    pdf: boolean
    images: boolean
    mcp: boolean
    shellCoding: boolean
}

export interface SearchRuntimeConfig {
    enabled: boolean
    backendUrl: string
    defaultResultCount: number
    timeoutMs: number
}

export interface ImageRuntimeConfig {
    enabled: boolean
    provider: ImageProviderId | null
    model: string | null
    envKey: string | null
}

export interface RoomPaths {
    roomRootDir: string
    runtimeDir: string
    runtimeLogsDir: string
    runtimeSecretsDir: string
    engineStateDir: string
    workspaceDir: string
    storeDir: string
    storeBlobsDir: string
    storeManifestsDir: string
    storeExportsDir: string
    runtimeConfigPath: string
    runtimeEnvPath: string
    runtimeLogPath: string
    runtimeMetadataPath: string
    runtimeHealthPath: string
    runtimeTokenPath: string
}

export interface RuntimeFileMetadata {
    roomId: string
    port: number
    pid: number | null
    startedAt: string | null
    configVersion: number
    tokenVersion: number
}

export interface RuntimeHealthSnapshot {
    roomId: string
    port: number | null
    pid: number | null
    healthy: boolean
    message: string
    checkedAt: string
}

export interface EncryptedSecretPayload {
    cipherText: Buffer
    nonce: Buffer
    authTag: Buffer
    keyVersion: number
}

export interface MaterializedSecretRef {
    entitlementId: string
    secretId: string
    filePath: string
    envKey: string
}

export interface MaterializedMcpServer {
    id: string
    provider: string
    allowedTools: string[]
    transport: McpTransport
    command: string | null
    args: string[]
    url: string | null
    env: Record<string, string>
    headers: Record<string, string>
}

export interface MaterializedGitHubBinding {
    enabled: boolean
    installationId: string | null
    accountLogin: string | null
    repositories: string[]
    tokenEnvKey: string | null
    tokenExpiresAt: string | null
    ghHostsPath: string | null
    gitCredentialsPath: string | null
    gitConfigPath: string | null
}

export interface MaterializedEntitlements {
    env: Record<string, string>
    internalEnv: Record<string, string>
    secretRefs: MaterializedSecretRef[]
    mcpServers: MaterializedMcpServer[]
    github: MaterializedGitHubBinding
}

export interface MaterializedProviderConfig {
    provider: string
    api: ProviderApi
    authMode: ProviderAuthMode
    model: string
    fallbackModels: string[]
    baseUrl: string | null
    envKey: string | null
}

export interface MaterializedRoomConfiguration {
    instructions: string
    roomMode: RoomMode
    capabilities: CapabilityConfig
    search: SearchRuntimeConfig
    image: ImageRuntimeConfig
    budgets: RunBudgetConfig
    provider: MaterializedProviderConfig
    entitlements: MaterializedEntitlements
}
