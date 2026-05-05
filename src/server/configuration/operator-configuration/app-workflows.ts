import { randomUUID } from 'node:crypto'
import type { ImageProviderId, JsonValue } from '../../domain/types'
import {
    appMcpConnectionRepository,
    appProviderConnectionRepository,
    appSettingsRepository,
    auditRepository,
    providerValidationRepository,
    secretRepository,
} from '../../db/repositories'
import { getAppEnv } from '../../config/env'
import { validateMcpConnection, validateProviderConnection } from '../connection-validation'
import {
    assertSupportedProvider,
    assertSupportedProviderApi,
    inferProviderAuthMode,
    normalizeProviderId,
    normalizeProviderModel,
    providerCatalog,
    providerRequiresStoredCredential,
    resolveProviderBaseUrl,
} from '../provider-config'
import {
    capabilityConfigToJson,
    normalizeCapabilityConfig,
    normalizeImageProvider,
    normalizeSearchConfig,
} from '../capabilities'
import type {
    AppSettingsSummary,
    McpConnectionSummary,
    McpSaveInput,
    OperatorConfigSnapshot,
    ProviderConnectionSummary,
    ProviderSaveInput,
} from './contracts'
import { mcpSaveSchema, providerSaveSchema } from './contracts'
import {
    imageConfigRecord,
    imageConfigSecretId,
    nullableText,
    parseArgs,
    parseCsv,
    parseHeaders,
    summarizeMcp,
    summarizeProvider,
    summarizeSettings,
    validateBaseUrl,
} from './helpers'
import { decryptSecretRecord, resolveSecret, upsertEncryptedSecret } from './secrets'

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

    const settings = await appSettingsRepository.getOrCreate()
    if (input.makeDefault && saved.status === 'ready') {
        await appSettingsRepository.update({
            defaultProviderConnectionId: saved.id,
            defaultModel: null,
            onboardingCompletedAt: settings.onboardingCompletedAt ?? new Date(),
        })
    } else if (
        input.id &&
        input.makeDefault === false &&
        settings.defaultProviderConnectionId === saved.id
    ) {
        await appSettingsRepository.update({
            defaultProviderConnectionId: null,
            defaultModel: null,
            onboardingCompletedAt: settings.onboardingCompletedAt,
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

export async function deleteProviderConnection(input: {
    id: string
    actorUserId: string
}): Promise<{ id: string }> {
    const existing = await appProviderConnectionRepository.findById(input.id)
    if (!existing) {
        throw new Error('Provider connection does not exist')
    }

    const roomReferences = await appProviderConnectionRepository.countRoomReferences(existing.id)
    if (roomReferences > 0) {
        throw new Error(
            `Provider connection is used by ${roomReferences} room${roomReferences === 1 ? '' : 's'}. Remove it from those rooms before deleting.`,
        )
    }

    const settings = await appSettingsRepository.getOrCreate()
    const wasDefault = settings.defaultProviderConnectionId === existing.id
    const deleted = await appProviderConnectionRepository.deleteByIdIfUnused(existing.id)
    if (!deleted) {
        const currentReferences = await appProviderConnectionRepository.countRoomReferences(
            existing.id,
        )
        if (currentReferences > 0) {
            throw new Error(
                `Provider connection is used by ${currentReferences} room${currentReferences === 1 ? '' : 's'}. Remove it from those rooms before deleting.`,
            )
        }
        throw new Error('Provider connection could not be deleted')
    }

    if (existing.credentialSecretId) {
        await secretRepository.deleteById(existing.credentialSecretId)
    }

    await auditRepository.appendEvent({
        actorUserId: input.actorUserId,
        roomId: null,
        action: 'provider_connection.deleted',
        payload: {
            providerConnectionId: existing.id,
            provider: existing.provider,
            authMode: existing.authMode,
            wasDefault,
            hadCredential: existing.credentialSecretId !== null,
        },
    })

    return { id: existing.id }
}

export async function deleteMcpConnection(input: {
    id: string
    actorUserId: string
}): Promise<{ id: string }> {
    const existing = await appMcpConnectionRepository.findById(input.id)
    if (!existing) {
        throw new Error('Connected tool does not exist')
    }

    const roomBindings = await appMcpConnectionRepository.countRoomBindings(existing.id)
    if (roomBindings > 0) {
        throw new Error(
            `Connected tool is used by ${roomBindings} room${roomBindings === 1 ? '' : 's'}. Remove it from those rooms before deleting.`,
        )
    }

    const deleted = await appMcpConnectionRepository.deleteByIdIfUnused(existing.id)
    if (!deleted) {
        const currentBindings = await appMcpConnectionRepository.countRoomBindings(existing.id)
        if (currentBindings > 0) {
            throw new Error(
                `Connected tool is used by ${currentBindings} room${currentBindings === 1 ? '' : 's'}. Remove it from those rooms before deleting.`,
            )
        }
        throw new Error('Connected tool could not be deleted')
    }

    if (existing.credentialSecretId) {
        await secretRepository.deleteById(existing.credentialSecretId)
    }

    await auditRepository.appendEvent({
        actorUserId: input.actorUserId,
        roomId: null,
        action: 'mcp_connection.deleted',
        payload: {
            mcpConnectionId: existing.id,
            serverKey: existing.serverKey,
            transport: existing.transport,
            hadCredential: existing.credentialSecretId !== null,
        },
    })

    return { id: existing.id }
}

export async function updateAppDefaults(input: {
    defaultProviderConnectionId: string | null
    defaultModel: string | null
    onboardingCompleted: boolean
    actorUserId: string
}): Promise<AppSettingsSummary> {
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
    }

    const current = await appSettingsRepository.getOrCreate()
    const saved = await appSettingsRepository.update({
        defaultProviderConnectionId: input.defaultProviderConnectionId,
        defaultModel: null,
        onboardingCompletedAt: input.onboardingCompleted
            ? (current.onboardingCompletedAt ?? new Date())
            : null,
        capabilityDefaults: undefined,
        searchConfig: undefined,
        imageConfig: undefined,
    })

    await auditRepository.appendEvent({
        actorUserId: input.actorUserId,
        roomId: null,
        action: 'app_settings.updated',
        payload: {
            defaultProviderConnectionId: saved.defaultProviderConnectionId,
            hasDefaultModel: false,
            onboardingCompleted: saved.onboardingCompletedAt !== null,
        },
    })

    return summarizeSettings(saved)
}

export async function updateAppCapabilitySettings(input: {
    capabilityDefaults: Record<string, boolean>
    search?: {
        enabled: boolean
        backendUrl: string
        defaultResultCount: number
        timeoutMs: number
    }
    image: {
        provider: ImageProviderId | null
        model: string | null
        apiKey?: string
    }
    actorUserId: string
}): Promise<AppSettingsSummary> {
    const current = await appSettingsRepository.getOrCreate()
    const capabilities = normalizeCapabilityConfig(input.capabilityDefaults)
    const search = normalizeSearchConfig((input.search ?? current.searchConfig) as JsonValue)
    const currentImageProvider = normalizeImageProvider(
        imageConfigRecord(current.imageConfig).provider,
    )
    const currentImageSecretId = imageConfigSecretId(current.imageConfig)
    const imageProvider = input.image.provider
    const imageModel = imageProvider ? nullableText(input.image.model) : null
    const imageApiKey = input.image.apiKey?.trim() ?? ''
    let imageSecretId: string | null = null

    if (imageProvider && !imageModel) {
        throw new Error('Default image model is required when image generation is enabled')
    }

    if (imageProvider && imageModel) {
        if (imageApiKey) {
            const secret = await upsertEncryptedSecret({
                keyName: `app_image:${imageProvider}:api_key`,
                plainText: imageApiKey,
            })
            imageSecretId = secret.id
        } else if (currentImageProvider === imageProvider && currentImageSecretId) {
            const existingSecret = await resolveSecret(currentImageSecretId)
            if (!existingSecret) {
                throw new Error('Saved image API key is missing; enter a new image API key')
            }
            imageSecretId = existingSecret.id
        } else {
            throw new Error('Image API key is required when enabling an app image provider')
        }
    }

    const imageConfig =
        imageProvider && imageModel && imageSecretId
            ? {
                  provider: imageProvider,
                  model: imageModel,
                  secretId: imageSecretId,
              }
            : {
                  provider: null,
                  model: null,
                  secretId: null,
              }

    const saved = await appSettingsRepository.update({
        defaultProviderConnectionId: current.defaultProviderConnectionId,
        defaultModel: current.defaultModel,
        onboardingCompletedAt: current.onboardingCompletedAt,
        capabilityDefaults: capabilityConfigToJson(capabilities),
        searchConfig: search as unknown as JsonValue,
        imageConfig: imageConfig as JsonValue,
    })

    if (currentImageSecretId && currentImageSecretId !== imageSecretId) {
        await secretRepository.deleteById(currentImageSecretId)
    }

    await auditRepository.appendEvent({
        actorUserId: input.actorUserId,
        roomId: null,
        action: 'app_capabilities.updated',
        payload: {
            enabledCapabilities: Object.entries(capabilityConfigToJson(capabilities))
                .filter(([, enabled]) => enabled)
                .map(([key]) => key),
            searchEnabled: search.enabled,
            imageProvider: imageConfig.provider,
            hasImageModel: imageConfig.model !== null,
            hasImageCredential: imageConfig.secretId !== null,
        },
    })

    return summarizeSettings(saved)
}
