import type {
    AppMcpConnectionRecord,
    AppProviderConnectionRecord,
    AppSettingsRecord,
    ImageProviderId,
    JsonValue,
} from '#/domain/domain-types'
import {
    capabilityConfigToJson,
    normalizeCapabilityConfig,
    normalizeImageProvider,
    normalizeSearchConfig,
    searchProviderSecretId,
    type SearchConfigDefaults,
} from '../capabilities'
import { providerRequiresStoredCredential, upperSnake } from '../provider-config'
import type {
    AppSettingsSummary,
    McpConnectionSummary,
    ProviderConnectionSummary,
} from './contracts'

export function toIso(value: Date | null): string | null {
    return value ? value.toISOString() : null
}

export function toStringArray(value: JsonValue): string[] {
    if (!Array.isArray(value)) {
        return []
    }

    return value.filter((item): item is string => typeof item === 'string')
}

export function toStringRecord(value: JsonValue): Record<string, string> {
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

export function parseCsv(value: string | undefined): string[] {
    return (value ?? '')
        .split(',')
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0)
}

export function parseArgs(value: string | undefined): string[] {
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

export function parseHeaders(value: string | undefined): Record<string, string> {
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

export function nullableText(value: string | null | undefined): string | null {
    const trimmed = value?.trim() ?? ''
    return trimmed ? trimmed : null
}

export function imageProviderEnvKey(provider: ImageProviderId): string {
    return provider === 'openai'
        ? 'AGENT_ROOM_IMAGE_OPENAI_API_KEY'
        : 'AGENT_ROOM_IMAGE_GEMINI_API_KEY'
}

export function isImageProviderEnvKey(envKey: string): boolean {
    const normalized = upperSnake(envKey)
    return (
        normalized === imageProviderEnvKey('openai') || normalized === imageProviderEnvKey('gemini')
    )
}

export function imageConfigRecord(value: JsonValue): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : {}
}

export function imageConfigSecretId(value: JsonValue): string | null {
    const record = imageConfigRecord(value)
    return typeof record.secretId === 'string' && record.secretId.trim()
        ? record.secretId.trim()
        : null
}

export function validateBaseUrl(baseUrl: string | null): string | null {
    if (!baseUrl) {
        return null
    }

    const parsed = new URL(baseUrl)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        throw new Error('Provider base URL must use http or https')
    }
    return parsed.toString().replace(/\/$/, '')
}

interface ProviderSummaryOptions {
    requireCodexCredential?: boolean
}

export function summarizeProvider(
    record: AppProviderConnectionRecord,
    options: ProviderSummaryOptions = {},
): ProviderConnectionSummary {
    const requiresCredential =
        providerRequiresStoredCredential({
            provider: record.provider,
            authMode: record.authMode,
        }) ||
        (options.requireCodexCredential === true && record.provider === 'openai-codex')
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

export const redactedMcpHeaderValue = '********'

interface McpSummaryOptions {
    redactHeaders?: boolean
}

function summarizeHeaders(headers: JsonValue, options: McpSummaryOptions): Record<string, string> {
    const parsed = toStringRecord(headers)
    if (options.redactHeaders !== true) {
        return parsed
    }
    return Object.fromEntries(Object.keys(parsed).map((key) => [key, redactedMcpHeaderValue]))
}

export function summarizeMcp(
    record: AppMcpConnectionRecord,
    options: McpSummaryOptions = {},
): McpConnectionSummary {
    return {
        id: record.id,
        name: record.name,
        serverKey: record.serverKey,
        transport: record.transport,
        command: record.command,
        args: toStringArray(record.args),
        url: record.url,
        headers: summarizeHeaders(record.headers, options),
        authMode: record.authMode,
        hasCredential: record.credentialSecretId !== null,
        allowedTools: toStringArray(record.allowedTools),
        status: record.status,
        validationMessage: record.validationMessage,
        lastValidatedAt: toIso(record.lastValidatedAt),
        updatedAt: record.updatedAt.toISOString(),
    }
}

interface SettingsSummaryOptions {
    searchDefaults?: SearchConfigDefaults
}

export function summarizeSettings(
    record: AppSettingsRecord,
    options: SettingsSummaryOptions = {},
): AppSettingsSummary {
    const search = normalizeSearchConfig(record.searchConfig, options.searchDefaults)
    const braveSecretId = searchProviderSecretId({
        config: record.searchConfig,
        provider: 'brave',
    })
    const browserbaseSecretId = searchProviderSecretId({
        config: record.searchConfig,
        provider: 'browserbase',
    })
    const imageConfig = imageConfigRecord(record.imageConfig)
    const imageSecretId = imageConfigSecretId(record.imageConfig)
    return {
        defaultProviderConnectionId: record.defaultProviderConnectionId,
        defaultModel: record.defaultModel,
        capabilityDefaults: capabilityConfigToJson(
            normalizeCapabilityConfig(record.capabilityDefaults),
        ),
        search: {
            enabled: search.enabled,
            backendUrl: search.backendUrl,
            defaultResultCount: search.defaultResultCount,
            timeoutMs: search.timeoutMs,
            maxSearchesPerRun: search.maxSearchesPerRun,
            brave: {
                enabled: search.brave.enabled,
                hasCredential: braveSecretId !== null,
                country: search.brave.country,
                searchLang: search.brave.searchLang,
                safeSearch: search.brave.safeSearch,
                timeoutMs: search.brave.timeoutMs,
                resultCount: search.brave.resultCount,
            },
            browserbase: {
                enabled: search.browserbase.enabled,
                hasCredential: browserbaseSecretId !== null,
                timeoutMs: search.browserbase.timeoutMs,
                resultCount: search.browserbase.resultCount,
            },
        },
        image: {
            provider: normalizeImageProvider(imageConfig.provider),
            model:
                typeof imageConfig.model === 'string' && imageConfig.model.trim()
                    ? imageConfig.model.trim()
                    : null,
            hasCredential: imageSecretId !== null,
        },
        onboardingCompletedAt: toIso(record.onboardingCompletedAt),
    }
}
