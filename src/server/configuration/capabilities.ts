import type {
    CapabilityConfig,
    CapabilityId,
    ImageProviderId,
    ImageRuntimeConfig,
    JsonValue,
    RunBudgetConfig,
    SearchRuntimeConfig,
} from '../domain/types'
import { capabilityIds, imageProviderIds } from '../domain/types'
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
    toolsProfile: string
    mcpConnectionCount: number
}): CapabilityConfig {
    const merged = normalizeCapabilityConfig(input.defaults)
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

    if (input.toolsProfile === 'read-only') {
        merged.shellCoding = false
        merged.documents = false
        merged.spreadsheets = false
        merged.presentations = false
        merged.pdf = false
        merged.images = false
    } else if (input.toolsProfile === 'minimal') {
        merged.documents = false
        merged.spreadsheets = false
        merged.presentations = false
        merged.pdf = false
        merged.images = false
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
