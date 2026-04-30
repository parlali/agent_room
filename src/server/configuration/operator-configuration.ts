import { randomUUID } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import {
    appMcpConnectionRepository,
    appProviderConnectionRepository,
    appSettingsRepository,
    auditRepository,
    providerValidationRepository,
    roomConfigRepository,
    roomMcpBindingRepository,
    roomRepository,
    roomSecretRepository,
    secretRepository,
} from '../db/repositories'
import type {
    AppMcpConnectionRecord,
    AppProviderConnectionRecord,
    AppSettingsRecord,
    ConnectionStatus,
    JsonValue,
    MaterializedEntitlements,
    MaterializedMcpServer,
    MaterializedProviderConfig,
    MaterializedRoomConfiguration,
    McpAuthMode,
    McpTransport,
    ProviderAuthMode,
    ProviderApi,
    RoomConfigRecord,
    RoomMcpBindingRecord,
    RoomProviderMode,
    RoomSecretRecord,
    RoomToolProfile,
    SecretRecord,
} from '../domain/types'
import {
    mcpAuthModes,
    mcpTransports,
    providerApis,
    providerAuthModes,
    roomProviderModes,
    roomSecretPurposes,
    roomToolProfiles,
} from '../domain/types'
import { getAppEnv } from '../config/env'
import { decryptSecret, encryptSecret } from '../security/encryption'
import {
    assertNoReservedRoomRuntimeEnvKeys,
    reservedRoomRuntimeEnvKeys,
} from '../security/process-env'
import {
    assertSupportedProvider,
    assertSupportedProviderApi,
    inferProviderAuthMode,
    normalizeProviderId,
    normalizeProviderModel,
    providerCatalog,
    providerEnvKey,
    providerRequiresStoredCredential,
    resolveProviderBaseUrl,
    upperSnake,
} from './provider-config'
import { inspectCodexAuthStatus, type CodexAuthStatus } from './codex-auth'
import { validateMcpConnection, validateProviderConnection } from './connection-validation'

const providerSaveSchema = z.object({
    id: z.string().uuid().optional(),
    label: z.string().trim().min(1),
    provider: z.string().trim().min(1),
    api: z.enum(providerApis),
    authMode: z.enum(providerAuthModes).optional(),
    baseUrl: z.string().trim().nullable().optional(),
    defaultModel: z.string().trim().min(1),
    fallbackModels: z.array(z.string().trim().min(1)).default([]),
    apiKey: z.string().optional(),
    makeDefault: z.boolean().optional(),
})

const mcpSaveSchema = z.object({
    id: z.string().uuid().optional(),
    name: z.string().trim().min(1),
    serverKey: z.string().trim().min(1),
    transport: z.enum(mcpTransports),
    command: z.string().trim().nullable().optional(),
    argsText: z.string().optional(),
    url: z.string().trim().nullable().optional(),
    headersText: z.string().optional(),
    authMode: z.enum(mcpAuthModes).default('none'),
    bearerToken: z.string().optional(),
    allowedToolsText: z.string().optional(),
})

const roomConfigSaveSchema = z.object({
    roomId: z.string().uuid(),
    instructions: z.string().default(''),
    providerMode: z.enum(roomProviderModes),
    providerConnectionId: z.string().uuid().nullable().optional(),
    provider: z.string().trim().nullable().optional(),
    providerApi: z.enum(providerApis).nullable().optional(),
    providerBaseUrl: z.string().trim().nullable().optional(),
    providerModel: z.string().trim().nullable().optional(),
    providerApiKey: z.string().optional(),
    toolsProfile: z.enum(roomToolProfiles).default('coding'),
    cronTimezone: z.string().trim().min(1).default('UTC'),
    mcpConnectionIds: z.array(z.string().uuid()).default([]),
})

const roomSecretSaveSchema = z.object({
    roomId: z.string().uuid(),
    label: z.string().trim().min(1),
    envKey: z.string().trim().min(1),
    purpose: z.enum(roomSecretPurposes),
    provider: z.string().trim().nullable().optional(),
    value: z.string().min(1),
})

export type ProviderSaveInput = z.input<typeof providerSaveSchema>
export type McpSaveInput = z.input<typeof mcpSaveSchema>
export type RoomConfigSaveInput = z.input<typeof roomConfigSaveSchema>
export type RoomSecretSaveInput = z.input<typeof roomSecretSaveSchema>

export interface ProviderConnectionSummary {
    id: string
    label: string
    provider: string
    authMode: ProviderAuthMode
    api: ProviderApi
    baseUrl: string | null
    defaultModel: string
    fallbackModels: string[]
    hasCredential: boolean
    status: ConnectionStatus
    validationMessage: string | null
    lastValidatedAt: string | null
    updatedAt: string
}

export interface McpConnectionSummary {
    id: string
    name: string
    serverKey: string
    transport: McpTransport
    command: string | null
    args: string[]
    url: string | null
    headers: Record<string, string>
    authMode: McpAuthMode
    hasCredential: boolean
    allowedTools: string[]
    status: ConnectionStatus
    validationMessage: string | null
    lastValidatedAt: string | null
    updatedAt: string
}

export interface AppSettingsSummary {
    defaultProviderConnectionId: string | null
    defaultModel: string | null
    onboardingCompletedAt: string | null
}

export interface OperatorConfigSnapshot {
    settings: AppSettingsSummary
    providerCatalog: typeof providerCatalog
    providers: ProviderConnectionSummary[]
    mcpConnections: McpConnectionSummary[]
    onboarding: {
        completed: boolean
        hasProvider: boolean
        hasDefaultProvider: boolean
    }
}

export interface RoomSecretSummary {
    id: string
    label: string
    envKey: string
    purpose: string
    provider: string | null
    updatedAt: string
}

export interface RoomConfigSnapshot {
    roomId: string
    config: {
        instructions: string
        providerMode: RoomProviderMode
        providerConnectionId: string | null
        provider: string | null
        providerApi: ProviderApi | null
        providerBaseUrl: string | null
        providerModel: string | null
        hasRoomProviderSecret: boolean
        toolsProfile: RoomToolProfile
        cronTimezone: string
        mcpConnectionIds: string[]
    }
    effective: {
        ready: boolean
        blockedReasons: string[]
        providerSource: 'app_default' | 'app_connection' | 'room_secret' | 'missing'
        providerLabel: string | null
        provider: string | null
        model: string | null
        mcpServers: string[]
        codexAuth: CodexAuthStatus | null
    }
    providers: ProviderConnectionSummary[]
    mcpConnections: McpConnectionSummary[]
    roomSecrets: RoomSecretSummary[]
}

function toIso(value: Date | null): string | null {
    return value ? value.toISOString() : null
}

function toStringArray(value: JsonValue): string[] {
    if (!Array.isArray(value)) {
        return []
    }

    return value.filter((item): item is string => typeof item === 'string')
}

function toStringRecord(value: JsonValue): Record<string, string> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return {}
    }

    const record: Record<string, string> = {}
    for (const [key, entry] of Object.entries(value)) {
        if (typeof entry === 'string') {
            record[key] = entry
        }
    }
    return record
}

function parseCsv(value: string | undefined): string[] {
    return (value ?? '')
        .split(',')
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0)
}

function parseArgs(value: string | undefined): string[] {
    const trimmed = (value ?? '').trim()
    if (!trimmed) {
        return []
    }

    try {
        const parsed = JSON.parse(trimmed)
        if (Array.isArray(parsed) && parsed.every((entry) => typeof entry === 'string')) {
            return parsed
        }
    } catch {
        return trimmed.split(/\s+/).filter((entry) => entry.length > 0)
    }

    throw new Error('MCP args must be a JSON string array or shell-style text')
}

function parseHeaders(value: string | undefined): Record<string, string> {
    const trimmed = (value ?? '').trim()
    if (!trimmed) {
        return {}
    }

    const parsed = JSON.parse(trimmed)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('MCP headers must be a JSON object')
    }

    const result: Record<string, string> = {}
    for (const [key, entry] of Object.entries(parsed)) {
        if (typeof entry !== 'string') {
            throw new Error('MCP header values must be strings')
        }
        result[key] = entry
    }
    return result
}

function nullableText(value: string | null | undefined): string | null {
    const trimmed = value?.trim() ?? ''
    return trimmed ? trimmed : null
}

function validateBaseUrl(baseUrl: string | null): string | null {
    if (!baseUrl) {
        return null
    }

    const parsed = new URL(baseUrl)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        throw new Error('Provider base URL must use http or https')
    }
    return parsed.toString().replace(/\/$/, '')
}

function summarizeProvider(record: AppProviderConnectionRecord): ProviderConnectionSummary {
    const requiresCredential = providerRequiresStoredCredential({
        provider: record.provider,
        authMode: record.authMode,
    })
    return {
        id: record.id,
        label: record.label,
        provider: record.provider,
        authMode: record.authMode,
        api: record.api,
        baseUrl: record.baseUrl,
        defaultModel: record.defaultModel,
        fallbackModels: toStringArray(record.fallbackModels),
        hasCredential: !requiresCredential || record.credentialSecretId !== null,
        status: record.status,
        validationMessage: record.validationMessage,
        lastValidatedAt: toIso(record.lastValidatedAt),
        updatedAt: record.updatedAt.toISOString(),
    }
}

function summarizeMcp(record: AppMcpConnectionRecord): McpConnectionSummary {
    return {
        id: record.id,
        name: record.name,
        serverKey: record.serverKey,
        transport: record.transport,
        command: record.command,
        args: toStringArray(record.args),
        url: record.url,
        headers: toStringRecord(record.headers),
        authMode: record.authMode,
        hasCredential: record.credentialSecretId !== null,
        allowedTools: toStringArray(record.allowedTools),
        status: record.status,
        validationMessage: record.validationMessage,
        lastValidatedAt: toIso(record.lastValidatedAt),
        updatedAt: record.updatedAt.toISOString(),
    }
}

function summarizeSettings(record: AppSettingsRecord): AppSettingsSummary {
    return {
        defaultProviderConnectionId: record.defaultProviderConnectionId,
        defaultModel: record.defaultModel,
        onboardingCompletedAt: toIso(record.onboardingCompletedAt),
    }
}

async function upsertEncryptedSecret(input: {
    keyName: string
    plainText: string
}): Promise<SecretRecord> {
    const env = getAppEnv()
    const existing = await secretRepository.findByKeyName(input.keyName)
    const encrypted = encryptSecret(
        input.plainText,
        env.encryptionKey,
        (existing?.keyVersion ?? 0) + 1,
    )
    return secretRepository.upsertSecret({
        keyName: input.keyName,
        cipherText: encrypted.cipherText,
        nonce: encrypted.nonce,
        authTag: encrypted.authTag,
        keyVersion: encrypted.keyVersion,
    })
}

async function resolveSecret(secretId: string | null): Promise<SecretRecord | null> {
    if (!secretId) {
        return null
    }
    return secretRepository.findById(secretId)
}

function decryptSecretRecord(secret: SecretRecord, encryptionKey: Buffer): string {
    return decryptSecret(
        {
            cipherText: secret.cipherText,
            nonce: secret.nonce,
            authTag: secret.authTag,
            keyVersion: secret.keyVersion,
        },
        encryptionKey,
    )
}

export async function getOperatorConfigSnapshot(): Promise<OperatorConfigSnapshot> {
    const [settings, providers, mcpConnections] = await Promise.all([
        appSettingsRepository.getOrCreate(),
        appProviderConnectionRepository.list(),
        appMcpConnectionRepository.list(),
    ])

    return {
        settings: summarizeSettings(settings),
        providerCatalog,
        providers: providers.map(summarizeProvider),
        mcpConnections: mcpConnections.map(summarizeMcp),
        onboarding: {
            completed: settings.onboardingCompletedAt !== null,
            hasProvider: providers.some((provider) => {
                const requiresCredential = providerRequiresStoredCredential({
                    provider: provider.provider,
                    authMode: provider.authMode,
                })
                return !requiresCredential || provider.credentialSecretId !== null
            }),
            hasDefaultProvider: settings.defaultProviderConnectionId !== null,
        },
    }
}

export async function saveProviderConnection(
    rawInput: ProviderSaveInput,
    actorUserId: string,
): Promise<ProviderConnectionSummary> {
    const input = providerSaveSchema.parse(rawInput)
    const id = input.id ?? randomUUID()
    const existing = input.id ? await appProviderConnectionRepository.findById(input.id) : null
    const provider = normalizeProviderId(input.provider)
    assertSupportedProvider(provider)
    assertSupportedProviderApi(provider, input.api)
    const authMode = input.authMode ?? inferProviderAuthMode({ provider, api: input.api })
    const apiKey = input.apiKey?.trim() ?? ''
    let credentialSecretId = existing?.credentialSecretId ?? null
    let secretAction: string | null = null
    const requiresCredential = providerRequiresStoredCredential({
        provider,
        authMode,
    })

    if (requiresCredential) {
        if (apiKey) {
            const secret = await upsertEncryptedSecret({
                keyName: `app_provider:${id}:api_key`,
                plainText: apiKey,
            })
            credentialSecretId = secret.id
            secretAction = existing?.credentialSecretId ? 'secret.rotated' : 'secret.created'
        } else if (!credentialSecretId) {
            throw new Error('Provider API key is required for a new provider connection')
        }
    } else {
        credentialSecretId = null
    }

    const baseUrl = resolveProviderBaseUrl({
        provider,
        api: input.api,
        baseUrl: validateBaseUrl(nullableText(input.baseUrl)),
    })
    const defaultModel = normalizeProviderModel(provider, input.defaultModel)
    let validationApiKey = requiresCredential ? apiKey || null : null
    if (requiresCredential && !validationApiKey && credentialSecretId) {
        const existingSecret = await resolveSecret(credentialSecretId)
        if (existingSecret) {
            validationApiKey = decryptSecretRecord(existingSecret, getAppEnv().encryptionKey)
        }
    }
    const validationStartedAt = new Date()
    const validation = await validateProviderConnection({
        provider,
        authMode,
        api: input.api,
        baseUrl,
        model: defaultModel,
        apiKey: validationApiKey,
    })
    const validationCompletedAt = new Date()
    const saved = await appProviderConnectionRepository.upsert({
        id,
        label: input.label,
        provider,
        authMode,
        api: input.api,
        baseUrl,
        defaultModel,
        fallbackModels: input.fallbackModels.map((model) =>
            normalizeProviderModel(provider, model),
        ),
        credentialSecretId,
        status: validation.status,
        validationMessage: validation.message,
        lastValidatedAt: validationCompletedAt,
        createdByUserId: actorUserId,
    })
    await providerValidationRepository.appendAttempt({
        providerConnectionId: saved.id,
        roomId: null,
        provider,
        authMode,
        api: input.api,
        baseUrl,
        model: defaultModel,
        status: validation.status,
        message: validation.message,
        startedAt: validationStartedAt,
        completedAt: validationCompletedAt,
    })

    if (input.makeDefault && saved.status === 'ready') {
        const settings = await appSettingsRepository.getOrCreate()
        await appSettingsRepository.update({
            defaultProviderConnectionId: saved.id,
            defaultModel: saved.defaultModel,
            onboardingCompletedAt: settings.onboardingCompletedAt ?? new Date(),
        })
    }

    if (secretAction) {
        await auditRepository.appendEvent({
            actorUserId,
            roomId: null,
            action: `provider_connection.${secretAction}`,
            payload: {
                providerConnectionId: saved.id,
                provider: saved.provider,
                authMode: saved.authMode,
            },
        })
    }

    await auditRepository.appendEvent({
        actorUserId,
        roomId: null,
        action: 'provider_connection.saved',
        payload: {
            providerConnectionId: saved.id,
            provider: saved.provider,
            authMode: saved.authMode,
            status: saved.status,
            hasCredential: saved.credentialSecretId !== null,
        },
    })

    return summarizeProvider(saved)
}

export async function saveMcpConnection(
    rawInput: McpSaveInput,
    actorUserId: string,
): Promise<McpConnectionSummary> {
    const input = mcpSaveSchema.parse(rawInput)
    const id = input.id ?? randomUUID()
    const existing = input.id ? await appMcpConnectionRepository.findById(input.id) : null
    const args = parseArgs(input.argsText)
    const headers = parseHeaders(input.headersText)
    const allowedTools = parseCsv(input.allowedToolsText)
    const command = nullableText(input.command)
    const url = nullableText(input.url)

    if (input.transport === 'stdio' && !command) {
        throw new Error('MCP stdio transport requires a command')
    }
    if (input.transport !== 'stdio' && !url) {
        throw new Error('MCP HTTP transport requires a URL')
    }
    if (url) {
        const parsed = new URL(url)
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
            throw new Error('MCP URL must use http or https')
        }
    }

    const bearerToken = input.bearerToken?.trim() ?? ''
    let credentialSecretId = existing?.credentialSecretId ?? null
    let secretAction: string | null = null

    if (input.authMode === 'bearer') {
        if (bearerToken) {
            const secret = await upsertEncryptedSecret({
                keyName: `app_mcp:${id}:bearer`,
                plainText: bearerToken,
            })
            credentialSecretId = secret.id
            secretAction = existing?.credentialSecretId ? 'secret.rotated' : 'secret.created'
        } else if (!credentialSecretId) {
            throw new Error('Bearer token is required for bearer-auth MCP connections')
        }
    } else {
        credentialSecretId = null
    }

    let validationBearerToken: string | null = null
    if (input.authMode === 'bearer') {
        validationBearerToken = bearerToken || null
        if (!validationBearerToken && credentialSecretId) {
            const existingSecret = await resolveSecret(credentialSecretId)
            if (existingSecret) {
                validationBearerToken = decryptSecretRecord(
                    existingSecret,
                    getAppEnv().encryptionKey,
                )
            }
        }
    }

    const validation = await validateMcpConnection({
        transport: input.transport,
        command,
        args,
        url,
        headers,
        authMode: input.authMode,
        bearerToken: validationBearerToken,
    })

    const saved = await appMcpConnectionRepository.upsert({
        id,
        name: input.name,
        serverKey: input.serverKey,
        transport: input.transport,
        command,
        args,
        url,
        headers,
        authMode: input.authMode,
        credentialSecretId,
        allowedTools,
        status: validation.status,
        validationMessage: validation.message,
        lastValidatedAt: new Date(),
        createdByUserId: actorUserId,
    })

    if (secretAction) {
        await auditRepository.appendEvent({
            actorUserId,
            roomId: null,
            action: `mcp_connection.${secretAction}`,
            payload: {
                mcpConnectionId: saved.id,
                serverKey: saved.serverKey,
            },
        })
    }

    await auditRepository.appendEvent({
        actorUserId,
        roomId: null,
        action: 'mcp_connection.saved',
        payload: {
            mcpConnectionId: saved.id,
            serverKey: saved.serverKey,
            transport: saved.transport,
            hasCredential: saved.credentialSecretId !== null,
        },
    })

    return summarizeMcp(saved)
}

export async function updateAppDefaults(input: {
    defaultProviderConnectionId: string | null
    defaultModel: string | null
    onboardingCompleted: boolean
    actorUserId: string
}): Promise<AppSettingsSummary> {
    let defaultModel = nullableText(input.defaultModel)
    if (input.defaultProviderConnectionId) {
        const provider = await appProviderConnectionRepository.findById(
            input.defaultProviderConnectionId,
        )
        if (!provider) {
            throw new Error('Default provider connection does not exist')
        }
        if (provider.status !== 'ready') {
            throw new Error(
                provider.validationMessage ??
                    `Default provider connection ${provider.label} is not ready`,
            )
        }
        if (defaultModel) {
            defaultModel = normalizeProviderModel(provider.provider, defaultModel)
            if (!defaultModel.startsWith(`${provider.provider}/`)) {
                throw new Error('Default model must belong to the selected default provider')
            }
        }
    } else {
        defaultModel = null
    }

    const current = await appSettingsRepository.getOrCreate()
    const saved = await appSettingsRepository.update({
        defaultProviderConnectionId: input.defaultProviderConnectionId,
        defaultModel,
        onboardingCompletedAt: input.onboardingCompleted
            ? (current.onboardingCompletedAt ?? new Date())
            : null,
    })

    await auditRepository.appendEvent({
        actorUserId: input.actorUserId,
        roomId: null,
        action: 'app_settings.updated',
        payload: {
            defaultProviderConnectionId: saved.defaultProviderConnectionId,
            hasDefaultModel: saved.defaultModel !== null,
            onboardingCompleted: saved.onboardingCompletedAt !== null,
        },
    })

    return summarizeSettings(saved)
}

async function upsertRoomProviderSecret(input: {
    roomId: string
    actorUserId: string
    provider: string
    apiKey: string
}): Promise<SecretRecord> {
    const provider = input.provider.trim().toLowerCase()
    const envKey = providerEnvKey(provider)
    const secret = await upsertEncryptedSecret({
        keyName: `room:${input.roomId}:provider:${provider}:api_key`,
        plainText: input.apiKey,
    })

    await roomSecretRepository.upsert({
        roomId: input.roomId,
        secretId: secret.id,
        label: `${provider} provider key`,
        envKey,
        purpose: 'provider_api_key',
        provider,
        createdByUserId: input.actorUserId,
    })

    return secret
}

export async function saveRoomConfig(
    rawInput: RoomConfigSaveInput,
    actorUserId: string,
): Promise<RoomConfigSnapshot> {
    const input = roomConfigSaveSchema.parse(rawInput)
    const room = await roomRepository.findRoomById(input.roomId)
    if (!room) {
        throw new Error(`Room ${input.roomId} does not exist`)
    }

    const existing = await roomConfigRepository.getOrCreate(input.roomId)
    let providerSecretId = existing.providerSecretId
    const provider = nullableText(input.provider)
        ? normalizeProviderId(nullableText(input.provider) ?? '')
        : null
    const providerApi = input.providerApi ?? null
    const providerModel = nullableText(input.providerModel)
    const roomProviderBaseUrl =
        input.providerMode === 'room_secret'
            ? validateBaseUrl(nullableText(input.providerBaseUrl))
            : null
    const normalizedProviderModel =
        input.providerMode === 'room_secret' && provider && providerModel
            ? normalizeProviderModel(provider, providerModel)
            : null

    if (input.providerMode === 'app_connection') {
        if (!input.providerConnectionId) {
            throw new Error('Room provider connection is required')
        }
        const providerConnection = await appProviderConnectionRepository.findById(
            input.providerConnectionId,
        )
        if (!providerConnection) {
            throw new Error('Room provider connection does not exist')
        }
        providerSecretId = null
    }

    if (input.providerMode === 'room_secret') {
        if (!provider || !providerApi || !normalizedProviderModel) {
            throw new Error('Room-scoped provider configuration requires provider, API, and model')
        }
        assertSupportedProvider(provider)
        assertSupportedProviderApi(provider, providerApi)
        if (inferProviderAuthMode({ provider, api: providerApi }) === 'oauth') {
            throw new Error('OpenAI Codex OAuth must be configured as an app provider connection')
        }

        const apiKey = input.providerApiKey?.trim() ?? ''
        const requiresCredential = providerRequiresStoredCredential({
            provider,
            authMode: 'api_key',
        })
        let validationApiKey = requiresCredential ? apiKey || null : null
        if (requiresCredential && !validationApiKey && providerSecretId) {
            const existingSecret = await resolveSecret(providerSecretId)
            if (existingSecret) {
                validationApiKey = decryptSecretRecord(existingSecret, getAppEnv().encryptionKey)
            }
        }
        const validationStartedAt = new Date()
        const validation = await validateProviderConnection({
            provider,
            authMode: 'api_key',
            api: providerApi,
            baseUrl: roomProviderBaseUrl,
            model: normalizedProviderModel,
            apiKey: validationApiKey,
        })
        await providerValidationRepository.appendAttempt({
            providerConnectionId: null,
            roomId: input.roomId,
            provider,
            authMode: 'api_key',
            api: providerApi,
            baseUrl: roomProviderBaseUrl,
            model: normalizedProviderModel,
            status: validation.status,
            message: validation.message,
            startedAt: validationStartedAt,
            completedAt: new Date(),
        })
        if (validation.status !== 'ready') {
            throw new Error(`Room-scoped provider validation failed: ${validation.message}`)
        }

        if (requiresCredential && apiKey) {
            const secret = await upsertRoomProviderSecret({
                roomId: input.roomId,
                actorUserId,
                provider,
                apiKey,
            })
            providerSecretId = secret.id
            await auditRepository.appendEvent({
                actorUserId,
                roomId: input.roomId,
                action: 'room_secret.rotated',
                payload: {
                    purpose: 'provider_api_key',
                    provider,
                },
            })
        } else if (requiresCredential && !providerSecretId) {
            throw new Error('Room-scoped provider API key is required')
        } else if (!requiresCredential) {
            providerSecretId = null
        }
    }

    const config = await roomConfigRepository.upsert({
        roomId: input.roomId,
        instructions: input.instructions.trim(),
        providerMode: input.providerMode,
        providerConnectionId:
            input.providerMode === 'app_connection' ? (input.providerConnectionId ?? null) : null,
        provider: input.providerMode === 'room_secret' ? provider : null,
        providerApi: input.providerMode === 'room_secret' ? providerApi : null,
        providerBaseUrl: input.providerMode === 'room_secret' ? roomProviderBaseUrl : null,
        providerModel: input.providerMode === 'room_secret' ? normalizedProviderModel : null,
        providerSecretId: input.providerMode === 'room_secret' ? providerSecretId : null,
        toolsProfile: input.toolsProfile,
        cronTimezone: input.cronTimezone,
    })

    await roomMcpBindingRepository.replaceForRoom(
        input.roomId,
        input.mcpConnectionIds.map((mcpConnectionId) => ({
            mcpConnectionId,
            allowedTools: [],
            enabled: true,
        })),
    )

    await auditRepository.appendEvent({
        actorUserId,
        roomId: input.roomId,
        action: 'room_config.updated',
        payload: {
            providerMode: config.providerMode,
            providerConnectionId: config.providerConnectionId,
            mcpConnectionCount: input.mcpConnectionIds.length,
            hasInstructions: config.instructions.length > 0,
        },
    })

    return getRoomConfigSnapshot(input.roomId)
}

export async function saveRoomSecret(
    rawInput: RoomSecretSaveInput,
    actorUserId: string,
): Promise<RoomSecretSummary> {
    const input = roomSecretSaveSchema.parse(rawInput)
    const room = await roomRepository.findRoomById(input.roomId)
    if (!room) {
        throw new Error(`Room ${input.roomId} does not exist`)
    }

    const envKey = upperSnake(input.envKey)
    if (!envKey) {
        throw new Error('Room secret env key must contain at least one letter or number')
    }
    assertNoReservedRoomRuntimeEnvKeys(
        {
            [envKey]: 'reserved-check',
        },
        'Room secret env key',
    )

    const secret = await upsertEncryptedSecret({
        keyName: `room:${input.roomId}:secret:${envKey}`,
        plainText: input.value,
    })
    const saved = await roomSecretRepository.upsert({
        roomId: input.roomId,
        secretId: secret.id,
        label: input.label,
        envKey,
        purpose: input.purpose,
        provider: nullableText(input.provider),
        createdByUserId: actorUserId,
    })

    await auditRepository.appendEvent({
        actorUserId,
        roomId: input.roomId,
        action: 'room_secret.saved',
        payload: {
            roomSecretId: saved.id,
            envKey: saved.envKey,
            purpose: saved.purpose,
            provider: saved.provider,
        },
    })

    return {
        id: saved.id,
        label: saved.label,
        envKey: saved.envKey,
        purpose: saved.purpose,
        provider: saved.provider,
        updatedAt: saved.updatedAt.toISOString(),
    }
}

function summarizeRoomConfig(input: {
    config: RoomConfigRecord
    bindings: RoomMcpBindingRecord[]
}): RoomConfigSnapshot['config'] {
    return {
        instructions: input.config.instructions,
        providerMode: input.config.providerMode,
        providerConnectionId: input.config.providerConnectionId,
        provider: input.config.provider,
        providerApi: input.config.providerApi,
        providerBaseUrl: input.config.providerBaseUrl,
        providerModel: input.config.providerModel,
        hasRoomProviderSecret: input.config.providerSecretId !== null,
        toolsProfile: input.config.toolsProfile,
        cronTimezone: input.config.cronTimezone,
        mcpConnectionIds: input.bindings
            .filter((binding) => binding.enabled)
            .map((binding) => binding.mcpConnectionId),
    }
}

async function resolveEffectiveRoomSummary(input: {
    roomId: string
    config: RoomConfigRecord
    settings: AppSettingsRecord
    providers: AppProviderConnectionRecord[]
    bindings: RoomMcpBindingRecord[]
    mcpConnections: AppMcpConnectionRecord[]
}): Promise<RoomConfigSnapshot['effective']> {
    const blockedReasons: string[] = []
    let providerSource: RoomConfigSnapshot['effective']['providerSource'] = 'missing'
    let providerLabel: string | null = null
    let provider: string | null = null
    let model: string | null = null
    let codexAuth: CodexAuthStatus | null = null

    if (input.config.providerMode === 'room_secret') {
        providerSource = 'room_secret'
        provider = input.config.provider
        model = input.config.providerModel
        providerLabel = input.config.provider ? `${input.config.provider} room key` : null
        if (!input.config.provider || !input.config.providerApi || !input.config.providerModel) {
            blockedReasons.push('Room-scoped provider details are incomplete')
        }
        if (
            input.config.provider &&
            !input.config.providerSecretId &&
            providerRequiresStoredCredential({
                provider: input.config.provider,
                authMode: 'api_key',
            })
        ) {
            blockedReasons.push('Room-scoped provider key is missing')
        }
    } else {
        const providerId =
            input.config.providerMode === 'app_connection'
                ? input.config.providerConnectionId
                : input.settings.defaultProviderConnectionId
        const providerConnection = providerId
            ? input.providers.find((entry) => entry.id === providerId)
            : null
        providerSource = input.config.providerMode
        if (!providerConnection) {
            blockedReasons.push(
                input.config.providerMode === 'app_connection'
                    ? 'Selected provider connection does not exist'
                    : 'App default provider connection is not configured',
            )
        } else {
            providerLabel = providerConnection.label
            provider = providerConnection.provider
            model =
                input.config.providerMode === 'app_default'
                    ? (input.settings.defaultModel ?? providerConnection.defaultModel)
                    : providerConnection.defaultModel
            if (providerConnection.authMode === 'oauth') {
                codexAuth =
                    providerConnection.provider === 'openai-codex' ||
                    providerConnection.api === 'openai-codex-responses'
                        ? await inspectCodexAuthStatus(input.roomId)
                        : null
                if (codexAuth && !codexAuth.ready) {
                    blockedReasons.push(codexAuth.message)
                }
            } else if (
                providerRequiresStoredCredential({
                    provider: providerConnection.provider,
                    authMode: providerConnection.authMode,
                }) &&
                !providerConnection.credentialSecretId
            ) {
                blockedReasons.push('Provider connection has no saved credential')
            } else if (providerConnection.status !== 'ready') {
                blockedReasons.push(
                    providerConnection.validationMessage ??
                        `Provider connection ${providerConnection.label} is ${providerConnection.status}`,
                )
            }
        }
    }

    for (const binding of input.bindings.filter((entry) => entry.enabled)) {
        const connection = input.mcpConnections.find(
            (entry) => entry.id === binding.mcpConnectionId,
        )
        if (!connection) {
            blockedReasons.push(
                `MCP binding ${binding.mcpConnectionId} points to a missing connection`,
            )
            continue
        }
        if (connection.authMode === 'bearer' && !connection.credentialSecretId) {
            blockedReasons.push(`MCP connection ${connection.serverKey} requires a bearer token`)
        }
        if (connection.status !== 'ready') {
            blockedReasons.push(
                connection.validationMessage ??
                    `MCP connection ${connection.serverKey} is ${connection.status}`,
            )
        }
    }

    return {
        ready: blockedReasons.length === 0,
        blockedReasons,
        providerSource,
        providerLabel,
        provider,
        model,
        mcpServers: input.bindings
            .filter((binding) => binding.enabled)
            .map((binding) => {
                const connection = input.mcpConnections.find(
                    (entry) => entry.id === binding.mcpConnectionId,
                )
                return connection?.serverKey ?? binding.mcpConnectionId
            }),
        codexAuth,
    }
}

export async function getRoomConfigSnapshot(roomId: string): Promise<RoomConfigSnapshot> {
    const [config, settings, providers, mcpConnections, bindings, roomSecrets] = await Promise.all([
        roomConfigRepository.getOrCreate(roomId),
        appSettingsRepository.getOrCreate(),
        appProviderConnectionRepository.list(),
        appMcpConnectionRepository.list(),
        roomMcpBindingRepository.listByRoomId(roomId),
        roomSecretRepository.listByRoomId(roomId),
    ])

    return {
        roomId,
        config: summarizeRoomConfig({
            config,
            bindings,
        }),
        effective: await resolveEffectiveRoomSummary({
            roomId,
            config,
            settings,
            providers,
            bindings,
            mcpConnections,
        }),
        providers: providers.map(summarizeProvider),
        mcpConnections: mcpConnections.map(summarizeMcp),
        roomSecrets: roomSecrets.map((secret) => ({
            id: secret.id,
            label: secret.label,
            envKey: secret.envKey,
            purpose: secret.purpose,
            provider: secret.provider,
            updatedAt: secret.updatedAt.toISOString(),
        })),
    }
}

export async function assertRoomConfigurationStartable(roomId: string): Promise<void> {
    const snapshot = await getRoomConfigSnapshot(roomId)
    if (snapshot.effective.ready) {
        return
    }

    throw new Error(
        `Room configuration is blocked: ${snapshot.effective.blockedReasons.join('; ')}`,
    )
}

async function resolveProviderForMaterialization(input: {
    roomId: string
    config: RoomConfigRecord
    settings: AppSettingsRecord
}): Promise<{
    source: RoomProviderMode
    provider: string
    authMode: ProviderAuthMode
    api: ProviderApi
    baseUrl: string | null
    model: string
    fallbackModels: string[]
    secret: SecretRecord | null
}> {
    if (input.config.providerMode === 'room_secret') {
        const secret = await resolveSecret(input.config.providerSecretId)
        const requiresCredential = providerRequiresStoredCredential({
            provider: input.config.provider ?? '',
            authMode: 'api_key',
        })
        if (
            !input.config.provider ||
            !input.config.providerApi ||
            !input.config.providerModel ||
            (requiresCredential && !secret)
        ) {
            throw new Error('Room provider configuration is incomplete')
        }
        return {
            source: 'room_secret',
            provider: input.config.provider,
            authMode: 'api_key',
            api: input.config.providerApi,
            baseUrl: input.config.providerBaseUrl,
            model: input.config.providerModel,
            fallbackModels: [],
            secret: requiresCredential ? secret : null,
        }
    }

    const providerConnectionId =
        input.config.providerMode === 'app_connection'
            ? input.config.providerConnectionId
            : input.settings.defaultProviderConnectionId

    if (!providerConnectionId) {
        throw new Error('Room has no effective provider connection')
    }

    const providerConnection = await appProviderConnectionRepository.findById(providerConnectionId)
    if (!providerConnection) {
        throw new Error('Room effective provider connection was not found')
    }

    const secret = await resolveSecret(providerConnection.credentialSecretId)
    const requiresCredential = providerRequiresStoredCredential({
        provider: providerConnection.provider,
        authMode: providerConnection.authMode,
    })
    if (requiresCredential && !secret) {
        throw new Error('Room effective provider credential is missing')
    }
    if (providerConnection.status !== 'ready') {
        throw new Error(
            providerConnection.validationMessage ??
                `Room effective provider connection ${providerConnection.label} is not ready`,
        )
    }
    if (
        providerConnection.authMode === 'oauth' &&
        (providerConnection.provider === 'openai-codex' ||
            providerConnection.api === 'openai-codex-responses')
    ) {
        const authStatus = await inspectCodexAuthStatus(input.roomId)
        if (!authStatus.ready) {
            throw new Error(authStatus.message)
        }
    }

    return {
        source: input.config.providerMode,
        provider: providerConnection.provider,
        authMode: providerConnection.authMode,
        api: providerConnection.api,
        baseUrl: providerConnection.baseUrl,
        model:
            input.config.providerMode === 'app_default'
                ? (input.settings.defaultModel ?? providerConnection.defaultModel)
                : providerConnection.defaultModel,
        fallbackModels: toStringArray(providerConnection.fallbackModels),
        secret: requiresCredential ? secret : null,
    }
}

async function materializeProvider(input: {
    runtimeSecretsDir: string
    provider: string
    authMode: ProviderAuthMode
    api: ProviderApi
    baseUrl: string | null
    model: string
    fallbackModels: string[]
    secret: SecretRecord | null
    encryptionKey: Buffer
}): Promise<{
    provider: MaterializedProviderConfig
    entitlements: Pick<MaterializedEntitlements, 'env' | 'secretRefs'>
}> {
    assertSupportedProvider(input.provider)
    assertSupportedProviderApi(input.provider, input.api)
    const envKey = providerRequiresStoredCredential({
        provider: input.provider,
        authMode: input.authMode,
    })
        ? providerEnvKey(input.provider)
        : null
    const env: Record<string, string> = {}
    const secretRefs: MaterializedEntitlements['secretRefs'] = []
    if (envKey && input.secret) {
        const plainText = decryptSecretRecord(input.secret, input.encryptionKey)
        const secretFilePath = join(input.runtimeSecretsDir, `${envKey.toLowerCase()}.secret`)
        await writeFile(secretFilePath, plainText, {
            encoding: 'utf8',
            mode: 0o600,
        })
        env[envKey] = plainText
        secretRefs.push({
            entitlementId: 'provider',
            secretId: input.secret.id,
            filePath: secretFilePath,
            envKey,
        })
    }

    return {
        provider: {
            provider: input.provider,
            authMode: input.authMode,
            api: input.api,
            model: input.model,
            fallbackModels: input.fallbackModels,
            baseUrl: resolveProviderBaseUrl({
                provider: input.provider,
                api: input.api,
                baseUrl: input.baseUrl,
            }),
            envKey,
        },
        entitlements: {
            env,
            secretRefs,
        },
    }
}

async function materializeRoomSecrets(input: {
    roomSecrets: RoomSecretRecord[]
    runtimeSecretsDir: string
    secretById: Map<string, SecretRecord>
    encryptionKey: Buffer
    reservedEnvKeys: Set<string>
}): Promise<Pick<MaterializedEntitlements, 'env' | 'secretRefs'>> {
    const env: Record<string, string> = {}
    const secretRefs: MaterializedEntitlements['secretRefs'] = []
    const usedEnvKeys = new Set(input.reservedEnvKeys)

    for (const roomSecret of input.roomSecrets) {
        const envKey = upperSnake(roomSecret.envKey)
        assertNoReservedRoomRuntimeEnvKeys(
            {
                [envKey]: 'reserved-check',
            },
            'Room secret env key',
        )
        if (usedEnvKeys.has(envKey)) {
            throw new Error(`Room secret env key ${envKey} conflicts with materialized config`)
        }

        const secret = input.secretById.get(roomSecret.secretId)
        if (!secret) {
            throw new Error(`Room secret ${roomSecret.label} is missing encrypted payload`)
        }

        const plainText = decryptSecretRecord(secret, input.encryptionKey)
        const secretFilePath = join(input.runtimeSecretsDir, `${envKey.toLowerCase()}.secret`)
        await writeFile(secretFilePath, plainText, {
            encoding: 'utf8',
            mode: 0o600,
        })

        env[envKey] = plainText
        secretRefs.push({
            entitlementId: `room_secret:${roomSecret.id}`,
            secretId: secret.id,
            filePath: secretFilePath,
            envKey,
        })
        usedEnvKeys.add(envKey)
    }

    return {
        env,
        secretRefs,
    }
}

async function materializeMcpBindings(input: {
    bindings: RoomMcpBindingRecord[]
    runtimeSecretsDir: string
    encryptionKey: Buffer
}): Promise<MaterializedMcpServer[]> {
    const servers: MaterializedMcpServer[] = []

    for (const binding of input.bindings.filter((entry) => entry.enabled)) {
        const connection = await appMcpConnectionRepository.findById(binding.mcpConnectionId)
        if (!connection) {
            throw new Error(
                `Room MCP binding ${binding.mcpConnectionId} points to a missing connection`,
            )
        }

        const env: Record<string, string> = {}
        const headers = {
            ...toStringRecord(connection.headers),
        }

        if (connection.authMode === 'bearer') {
            const secret = await resolveSecret(connection.credentialSecretId)
            if (!secret) {
                throw new Error(
                    `MCP connection ${connection.serverKey} requires a saved bearer token`,
                )
            }
            const plainText = decryptSecretRecord(secret, input.encryptionKey)
            if (connection.transport === 'stdio') {
                env.MCP_AUTH_TOKEN = plainText
            } else {
                headers.Authorization = `Bearer ${plainText}`
            }
        }

        servers.push({
            id: connection.serverKey,
            provider: connection.name,
            allowedTools:
                toStringArray(binding.allowedTools).length > 0
                    ? toStringArray(binding.allowedTools)
                    : toStringArray(connection.allowedTools),
            transport: connection.transport,
            command: connection.command,
            args: toStringArray(connection.args),
            url: connection.url,
            env,
            headers,
        })
    }

    return servers
}

export async function materializeRoomConfiguration(input: {
    roomId: string
    runtimeSecretsDir: string
}): Promise<MaterializedRoomConfiguration> {
    const env = getAppEnv()
    const [config, settings, bindings, roomSecrets] = await Promise.all([
        roomConfigRepository.getOrCreate(input.roomId),
        appSettingsRepository.getOrCreate(),
        roomMcpBindingRepository.listByRoomId(input.roomId),
        roomSecretRepository.listByRoomId(input.roomId),
    ])
    const providerSelection = await resolveProviderForMaterialization({
        roomId: input.roomId,
        config,
        settings,
    })
    const providerMaterialization = await materializeProvider({
        runtimeSecretsDir: input.runtimeSecretsDir,
        provider: providerSelection.provider,
        authMode: providerSelection.authMode,
        api: providerSelection.api,
        baseUrl: providerSelection.baseUrl,
        model: providerSelection.model,
        fallbackModels: providerSelection.fallbackModels,
        secret: providerSelection.secret,
        encryptionKey: env.encryptionKey,
    })
    const materializedRoomSecrets = roomSecrets.filter(
        (roomSecret) => roomSecret.secretId !== providerSelection.secret?.id,
    )
    const roomSecretRecords = await Promise.all(
        materializedRoomSecrets.map((roomSecret) => secretRepository.findById(roomSecret.secretId)),
    )
    const roomSecretById = new Map<string, SecretRecord>()
    for (const secret of roomSecretRecords) {
        if (secret) {
            roomSecretById.set(secret.id, secret)
        }
    }
    const roomSecretMaterialization = await materializeRoomSecrets({
        roomSecrets: materializedRoomSecrets,
        runtimeSecretsDir: input.runtimeSecretsDir,
        secretById: roomSecretById,
        encryptionKey: env.encryptionKey,
        reservedEnvKeys: new Set(Object.keys(providerMaterialization.entitlements.env)),
    })
    const mcpServers = await materializeMcpBindings({
        bindings,
        runtimeSecretsDir: input.runtimeSecretsDir,
        encryptionKey: env.encryptionKey,
    })

    return {
        instructions: config.instructions,
        toolsProfile: config.toolsProfile,
        provider: providerMaterialization.provider,
        entitlements: {
            env: {
                ...providerMaterialization.entitlements.env,
                ...roomSecretMaterialization.env,
            },
            secretRefs: [
                ...providerMaterialization.entitlements.secretRefs,
                ...roomSecretMaterialization.secretRefs,
            ],
            mcpServers,
        },
    }
}

export const __testing = {
    materializeRoomSecrets,
    reservedRoomRuntimeEnvKeys,
}
