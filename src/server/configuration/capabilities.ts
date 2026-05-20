import type {
    CapabilityConfig,
    CapabilityId,
    ImageProviderId,
    ImageRuntimeConfig,
    JsonValue,
    RoomMode,
    RunBudgetConfig,
    SearchProviderId,
    SearchRuntimeConfig,
    SearchSafeSearch,
} from '../domain/types'
import { capabilityIds, imageProviderIds, searchSafeSearchValues } from '../domain/types'
import { getAppEnv } from '../config/env'

export const defaultCapabilities: CapabilityConfig = {
    webSearch: true,
    urlFetch: true,
    documents: true,
    spreadsheets: true,
    presentations: true,
    pdf: true,
    images: true,
    mcp: true,
    shellCoding: true,
}

const capabilityKeyById = {
    web_search: 'webSearch',
    url_fetch: 'urlFetch',
    documents: 'documents',
    spreadsheets: 'spreadsheets',
    presentations: 'presentations',
    pdf: 'pdf',
    images: 'images',
    mcp: 'mcp',
    shell_coding: 'shellCoding',
} as const satisfies Record<CapabilityId, keyof CapabilityConfig>

export function capabilityConfigToJson(config: CapabilityConfig): Record<CapabilityId, boolean> {
    return capabilityIds.reduce(
        (out, id) => {
            out[id] = config[capabilityKeyById[id]]
            return out
        },
        {} as Record<CapabilityId, boolean>,
    )
}

export function normalizeCapabilityConfig(value: JsonValue | unknown): CapabilityConfig {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return { ...defaultCapabilities }
    }

    const record = value as Record<string, unknown>
    const normalized = { ...defaultCapabilities }
    for (const id of capabilityIds) {
        const key = capabilityKeyById[id]
        const directValue = record[id] ?? record[key]
        if (typeof directValue === 'boolean') {
            normalized[key] = directValue
        }
    }
    return normalized
}

export function mergeCapabilities(input: {
    defaults: JsonValue
    overrides: JsonValue
    roomMode: RoomMode
    mcpConnectionCount: number
}): CapabilityConfig {
    const merged = normalizeCapabilityConfig(input.defaults)
    if (input.roomMode === 'programmer') {
        merged.webSearch = true
        merged.urlFetch = true
        merged.shellCoding = true
        merged.documents = false
        merged.spreadsheets = false
        merged.presentations = false
        merged.pdf = false
    }

    const overrides =
        input.overrides && typeof input.overrides === 'object' && !Array.isArray(input.overrides)
            ? (input.overrides as Record<string, unknown>)
            : {}

    for (const id of capabilityIds) {
        const key = capabilityKeyById[id]
        const value = overrides[id] ?? overrides[key]
        if (typeof value === 'boolean') {
            merged[key] = value
        }
    }

    if (input.roomMode === 'programmer') {
        merged.documents = false
        merged.spreadsheets = false
        merged.presentations = false
        merged.pdf = false
    }

    if (input.mcpConnectionCount === 0) {
        merged.mcp = false
    }

    return merged
}

export function normalizeSearchConfig(value: JsonValue | unknown): SearchRuntimeConfig {
    const env = getAppEnv()
    const record =
        value && typeof value === 'object' && !Array.isArray(value)
            ? (value as Record<string, unknown>)
            : {}
    return {
        enabled: typeof record.enabled === 'boolean' ? record.enabled : env.search.enabled,
        backendUrl:
            typeof record.backendUrl === 'string' && record.backendUrl.trim()
                ? record.backendUrl.trim().replace(/\/$/, '')
                : env.search.backendUrl,
        defaultResultCount:
            typeof record.defaultResultCount === 'number' &&
            Number.isFinite(record.defaultResultCount)
                ? Math.max(1, Math.min(20, Math.floor(record.defaultResultCount)))
                : env.search.defaultResultCount,
        timeoutMs:
            typeof record.timeoutMs === 'number' && Number.isFinite(record.timeoutMs)
                ? Math.max(1000, Math.min(30000, Math.floor(record.timeoutMs)))
                : env.search.timeoutMs,
        maxSearchesPerRun:
            typeof record.maxSearchesPerRun === 'number' &&
            Number.isFinite(record.maxSearchesPerRun)
                ? Math.max(1, Math.min(100, Math.floor(record.maxSearchesPerRun)))
                : env.search.maxSearchesPerRun,
        brave: normalizeBraveSearchConfig(record.brave),
        browserbase: normalizeBrowserbaseSearchConfig(record.browserbase),
    }
}

export function searchProviderEnvKey(provider: Exclude<SearchProviderId, 'searxng'>): string {
    return provider === 'brave'
        ? 'AGENT_ROOM_SEARCH_BRAVE_API_KEY'
        : 'AGENT_ROOM_SEARCH_BROWSERBASE_API_KEY'
}

export function searchProviderSecretId(input: {
    config: JsonValue
    provider: Exclude<SearchProviderId, 'searxng'>
}): string | null {
    const record =
        input.config && typeof input.config === 'object' && !Array.isArray(input.config)
            ? (input.config as Record<string, unknown>)
            : {}
    const providerRecord = searchProviderRecord(record[input.provider])
    return typeof providerRecord.secretId === 'string' && providerRecord.secretId.trim()
        ? providerRecord.secretId.trim()
        : null
}

export function withSearchProviderEnvKeys(
    config: SearchRuntimeConfig,
    providers: Partial<Record<Exclude<SearchProviderId, 'searxng'>, boolean>>,
): SearchRuntimeConfig {
    return {
        ...config,
        brave: {
            ...config.brave,
            envKey: providers.brave && config.brave.enabled ? searchProviderEnvKey('brave') : null,
        },
        browserbase: {
            ...config.browserbase,
            envKey:
                providers.browserbase && config.browserbase.enabled
                    ? searchProviderEnvKey('browserbase')
                    : null,
        },
    }
}

function searchProviderRecord(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : {}
}

function normalizeSearchSafeSearch(value: unknown): SearchSafeSearch {
    return typeof value === 'string' && searchSafeSearchValues.includes(value as SearchSafeSearch)
        ? (value as SearchSafeSearch)
        : 'moderate'
}

function normalizeOptionalString(value: unknown): string | null {
    return typeof value === 'string' && value.trim() ? value.trim() : null
}

function normalizeSearchTimeout(value: unknown, fallback: number): number {
    return typeof value === 'number' && Number.isFinite(value)
        ? Math.max(1000, Math.min(30000, Math.floor(value)))
        : fallback
}

function normalizeSearchResultCount(value: unknown, fallback: number): number {
    return typeof value === 'number' && Number.isFinite(value)
        ? Math.max(1, Math.min(20, Math.floor(value)))
        : fallback
}

function normalizeBraveSearchConfig(value: unknown): SearchRuntimeConfig['brave'] {
    const env = getAppEnv()
    const record = searchProviderRecord(value)
    return {
        enabled: typeof record.enabled === 'boolean' ? record.enabled : false,
        envKey: null,
        country: normalizeOptionalString(record.country),
        searchLang: normalizeOptionalString(record.searchLang),
        safeSearch: normalizeSearchSafeSearch(record.safeSearch),
        timeoutMs: normalizeSearchTimeout(record.timeoutMs, env.search.timeoutMs),
        resultCount: normalizeSearchResultCount(record.resultCount, env.search.defaultResultCount),
    }
}

function normalizeBrowserbaseSearchConfig(value: unknown): SearchRuntimeConfig['browserbase'] {
    const env = getAppEnv()
    const record = searchProviderRecord(value)
    return {
        enabled: typeof record.enabled === 'boolean' ? record.enabled : false,
        envKey: null,
        timeoutMs: normalizeSearchTimeout(record.timeoutMs, env.search.timeoutMs),
        resultCount: normalizeSearchResultCount(record.resultCount, env.search.defaultResultCount),
    }
}

export function normalizeBudgets(): RunBudgetConfig {
    const env = getAppEnv()
    return { ...env.budgets }
}

export function normalizeImageProvider(value: unknown): ImageProviderId | null {
    return typeof value === 'string' && imageProviderIds.includes(value as ImageProviderId)
        ? (value as ImageProviderId)
        : null
}

export function normalizeImageConfig(input: {
    appConfig: JsonValue
    roomProvider: ImageProviderId | null
    roomModel: string | null
    envKey: string | null
}): ImageRuntimeConfig {
    const record =
        input.appConfig && typeof input.appConfig === 'object' && !Array.isArray(input.appConfig)
            ? (input.appConfig as Record<string, unknown>)
            : {}
    const provider = input.roomProvider ?? normalizeImageProvider(record.provider)
    const model =
        input.roomModel ??
        (typeof record.model === 'string' && record.model.trim() ? record.model.trim() : null)

    return {
        enabled: provider !== null && model !== null && input.envKey !== null,
        provider,
        model,
        envKey: input.envKey,
    }
}
