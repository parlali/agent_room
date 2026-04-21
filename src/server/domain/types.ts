export const roomStatuses = ['starting', 'running', 'stopped', 'degraded', 'failed'] as const
export const roomDesiredStates = ['running', 'stopped'] as const
export const userRoles = ['root', 'operator'] as const
export const entitlementKinds = [
    'provider_credential',
    'mail',
    'calendar',
    'github',
    'mcp',
    'webhook',
] as const
export const entitlementStatuses = ['active', 'revoked'] as const
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

export type RoomStatus = (typeof roomStatuses)[number]
export type RoomDesiredState = (typeof roomDesiredStates)[number]
export type UserRole = (typeof userRoles)[number]
export type EntitlementKind = (typeof entitlementKinds)[number]
export type EntitlementStatus = (typeof entitlementStatuses)[number]
export type HealthStatus = (typeof healthStatuses)[number]
export type ArtifactKind = (typeof artifactKinds)[number]
export type ConnectionStatus = (typeof connectionStatuses)[number]
export type ProviderApi = (typeof providerApis)[number]
export type ProviderAuthMode = (typeof providerAuthModes)[number]
export type McpTransport = (typeof mcpTransports)[number]
export type McpAuthMode = (typeof mcpAuthModes)[number]
export type RoomProviderMode = (typeof roomProviderModes)[number]
export type RoomSecretPurpose = (typeof roomSecretPurposes)[number]

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

export interface RoomEntitlementRecord {
    id: string
    roomId: string
    kind: EntitlementKind
    provider: string
    accountId: string | null
    serverId: string | null
    scope: JsonValue
    secretId: string | null
    status: EntitlementStatus
    version: number
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
    onboardingCompletedAt: Date | null
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
    toolsProfile: string
    cronTimezone: string
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
    startedAt: string
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

export interface MaterializedEntitlements {
    env: Record<string, string>
    secretRefs: MaterializedSecretRef[]
    mcpServers: MaterializedMcpServer[]
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
    toolsProfile: string
    provider: MaterializedProviderConfig
    entitlements: MaterializedEntitlements
}

export interface OpenClawRuntimeConfig {
    env: {
        shellEnv: {
            enabled: boolean
        }
    }
    gateway: {
        mode: 'local'
        bind: 'loopback'
        port: number
        controlUi: {
            enabled: boolean
        }
        auth: {
            mode: 'token'
        }
    }
    agents: {
        defaults: {
            workspace: string
            model?: {
                primary: string
                fallbacks?: string[]
            }
            models?: Record<
                string,
                {
                    params: Record<string, string | number | boolean>
                }
            >
        }
        list?: Array<{
            id: string
            default: boolean
            name: string
            workspace: string
            agentDir: string
            model: {
                primary: string
                fallbacks?: string[]
            }
            identity: {
                name: string
                theme: string
            }
            tools: {
                profile: string
            }
            instructions?: string
        }>
    }
    tools: {
        profile: string
    }
    models?: {
        mode: 'merge'
        providers: Record<
            string,
            {
                baseUrl?: string
                apiKey?: string
                api: ProviderApi
                models: Array<{
                    id: string
                    name: string
                    contextTokens?: number
                }>
            }
        >
    }
    auth?: {
        order?: Record<string, string[]>
    }
    mcp: {
        servers: Record<
            string,
            {
                command?: string
                args?: string[]
                env?: Record<string, string | number | boolean>
                cwd?: string
                workingDirectory?: string
                url?: string
                transport?: 'streamable-http'
                headers?: Record<string, string | number | boolean>
            }
        >
    }
}
