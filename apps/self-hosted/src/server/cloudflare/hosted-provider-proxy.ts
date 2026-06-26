import { nullableObjectRecord } from './hosted-json'

export const hostedOpenRouterProxyPathPrefix = '/api/hosted/runtime/provider/openrouter/v1'
const hostedOpenRouterProxyAllowedPaths = new Set(['/chat/completions'])
export const hostedBraveProxyPathPrefix = '/api/hosted/runtime/provider/brave/v1'
const hostedBraveProxyAllowedPaths = new Set(['/res/v1/web/search'])
export const hostedBrowserbaseProxyPathPrefix = '/api/hosted/runtime/provider/browserbase/v1'
export const hostedManagedFetchPathPrefix = '/api/hosted/runtime/fetch'

interface HostedProxyPath {
    workspaceId: string
    roomId: string
    targetPath: string
}

export type HostedOpenRouterProxyPath = HostedProxyPath
export type HostedBraveProxyPath = HostedProxyPath
export type HostedBrowserbaseProxyPath = HostedProxyPath
export interface HostedManagedFetchPath {
    workspaceId: string
    roomId: string
}

function makeHostedProxyPathHelpers(
    prefix: string,
    targetPath: (suffix: string) => string | null,
): {
    targetPath: (suffix: string) => string | null
    parse: (pathname: string) => HostedProxyPath | null
} {
    const parse = (pathname: string): HostedProxyPath | null => {
        if (!pathname.startsWith(prefix)) {
            return null
        }
        const suffix = pathname.slice(prefix.length)
        const match = suffix.match(/^\/workspaces\/([^/]+)\/rooms\/([^/]+)(\/.*)$/)
        if (!match) {
            return null
        }
        const resolved = targetPath(match[3]!)
        if (!resolved) {
            return null
        }
        return {
            workspaceId: decodeURIComponent(match[1]!),
            roomId: decodeURIComponent(match[2]!),
            targetPath: resolved,
        }
    }
    return { targetPath, parse }
}

function targetPathFromAllowedPaths(allowedPaths: Set<string>): (suffix: string) => string | null {
    return (suffix: string): string | null => {
        const path = suffix.startsWith('/') ? suffix : `/${suffix}`
        return allowedPaths.has(path) ? path : null
    }
}

const hostedOpenRouterProxyPathHelpers = makeHostedProxyPathHelpers(
    hostedOpenRouterProxyPathPrefix,
    targetPathFromAllowedPaths(hostedOpenRouterProxyAllowedPaths),
)
const hostedBraveProxyPathHelpers = makeHostedProxyPathHelpers(
    hostedBraveProxyPathPrefix,
    targetPathFromAllowedPaths(hostedBraveProxyAllowedPaths),
)

function browserbaseTargetPath(suffix: string): string | null {
    const path = suffix.startsWith('/') ? suffix : `/${suffix}`
    if (path === '/search' || path === '/sessions') {
        return path
    }
    if (/^\/sessions\/[^/]+$/.test(path) || /^\/sessions\/[^/]+\/debug$/.test(path)) {
        return path
    }
    return null
}

const hostedBrowserbaseProxyPathHelpers = makeHostedProxyPathHelpers(
    hostedBrowserbaseProxyPathPrefix,
    browserbaseTargetPath,
)

export function parseHostedManagedFetchPath(pathname: string): HostedManagedFetchPath | null {
    if (!pathname.startsWith(hostedManagedFetchPathPrefix)) {
        return null
    }
    const suffix = pathname.slice(hostedManagedFetchPathPrefix.length)
    const match = suffix.match(/^\/workspaces\/([^/]+)\/rooms\/([^/]+)$/)
    if (!match) {
        return null
    }
    return {
        workspaceId: decodeURIComponent(match[1]!),
        roomId: decodeURIComponent(match[2]!),
    }
}

export function hostedOpenRouterProxyBaseUrl(input: {
    publicOrigin: string
    workspaceId: string
    roomId: string
}): string {
    const origin = input.publicOrigin.replace(/\/$/, '')
    return `${origin}${hostedOpenRouterProxyPathPrefix}/workspaces/${encodeURIComponent(input.workspaceId)}/rooms/${encodeURIComponent(input.roomId)}`
}

export function hostedBraveProxyBaseUrl(input: {
    publicOrigin: string
    workspaceId: string
    roomId: string
}): string {
    const origin = input.publicOrigin.replace(/\/$/, '')
    return `${origin}${hostedBraveProxyPathPrefix}/workspaces/${encodeURIComponent(input.workspaceId)}/rooms/${encodeURIComponent(input.roomId)}/res/v1/web/search`
}

export function hostedBrowserbaseProxyBaseUrl(input: {
    publicOrigin: string
    workspaceId: string
    roomId: string
}): string {
    const origin = input.publicOrigin.replace(/\/$/, '')
    return `${origin}${hostedBrowserbaseProxyPathPrefix}/workspaces/${encodeURIComponent(input.workspaceId)}/rooms/${encodeURIComponent(input.roomId)}`
}

export function hostedManagedFetchProxyUrl(input: {
    publicOrigin: string
    workspaceId: string
    roomId: string
}): string {
    const origin = input.publicOrigin.replace(/\/$/, '')
    return `${origin}${hostedManagedFetchPathPrefix}/workspaces/${encodeURIComponent(input.workspaceId)}/rooms/${encodeURIComponent(input.roomId)}`
}

export const hostedOpenRouterProxyTargetPath = hostedOpenRouterProxyPathHelpers.targetPath
export const hostedBraveProxyTargetPath = hostedBraveProxyPathHelpers.targetPath
export const hostedBrowserbaseProxyTargetPath = hostedBrowserbaseProxyPathHelpers.targetPath
export const parseHostedOpenRouterProxyPath = hostedOpenRouterProxyPathHelpers.parse
export const parseHostedBraveProxyPath = hostedBraveProxyPathHelpers.parse
export const parseHostedBrowserbaseProxyPath = hostedBrowserbaseProxyPathHelpers.parse

export interface OpenRouterProviderUsageSnapshot {
    costMicros: number | null
    inputTokens: number | null
    outputTokens: number | null
    cachedTokens: number | null
    reasoningTokens: number | null
    totalTokens: number | null
}

function openRouterTokenCount(value: unknown): number | null {
    return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null
}

function openRouterCostDollars(value: unknown): number | null {
    const numeric =
        typeof value === 'number'
            ? value
            : typeof value === 'string' && value.trim() !== ''
              ? Number(value)
              : null
    return numeric !== null && Number.isFinite(numeric) && numeric >= 0 ? numeric : null
}

function openRouterCostMicrosFromDollars(value: unknown): number | null {
    const dollars = openRouterCostDollars(value)
    if (dollars === null) {
        return null
    }
    const micros = Math.round(dollars * 1_000_000)
    return Number.isSafeInteger(micros) && micros >= 0 ? micros : null
}

function emptyOpenRouterUsageSnapshot(): OpenRouterProviderUsageSnapshot {
    return {
        costMicros: null,
        inputTokens: null,
        outputTokens: null,
        cachedTokens: null,
        reasoningTokens: null,
        totalTokens: null,
    }
}

export function openRouterUsageSnapshotFromProviderPayload(
    value: unknown,
): OpenRouterProviderUsageSnapshot | null {
    const record = nullableObjectRecord(value)
    if (!record) {
        return null
    }
    const usage = nullableObjectRecord(record.usage)
    if (!usage) {
        return null
    }
    const promptDetails = nullableObjectRecord(usage.prompt_tokens_details)
    const completionDetails = nullableObjectRecord(usage.completion_tokens_details)
    return {
        ...emptyOpenRouterUsageSnapshot(),
        costMicros: openRouterCostMicrosFromDollars(usage.cost),
        inputTokens: openRouterTokenCount(usage.prompt_tokens),
        outputTokens: openRouterTokenCount(usage.completion_tokens),
        cachedTokens: openRouterTokenCount(promptDetails?.cached_tokens),
        reasoningTokens: openRouterTokenCount(completionDetails?.reasoning_tokens),
        totalTokens: openRouterTokenCount(usage.total_tokens),
    }
}

export function openRouterCostMicrosFromProviderPayload(value: unknown): number | null {
    return openRouterUsageSnapshotFromProviderPayload(value)?.costMicros ?? null
}

function hasOpenRouterUsageSnapshotValue(value: OpenRouterProviderUsageSnapshot): boolean {
    return Object.values(value).some((entry) => entry !== null)
}

function mergeOpenRouterUsageSnapshots(
    current: OpenRouterProviderUsageSnapshot,
    next: OpenRouterProviderUsageSnapshot,
): OpenRouterProviderUsageSnapshot {
    return {
        costMicros: next.costMicros ?? current.costMicros,
        inputTokens: next.inputTokens ?? current.inputTokens,
        outputTokens: next.outputTokens ?? current.outputTokens,
        cachedTokens: next.cachedTokens ?? current.cachedTokens,
        reasoningTokens: next.reasoningTokens ?? current.reasoningTokens,
        totalTokens: next.totalTokens ?? current.totalTokens,
    }
}

export function openRouterUsageSnapshotFromProviderText(
    text: string,
): OpenRouterProviderUsageSnapshot {
    const trimmed = text.trim()
    if (!trimmed) {
        return emptyOpenRouterUsageSnapshot()
    }
    if (!trimmed.includes('\ndata:') && !trimmed.startsWith('data:')) {
        try {
            return (
                openRouterUsageSnapshotFromProviderPayload(JSON.parse(trimmed) as unknown) ??
                emptyOpenRouterUsageSnapshot()
            )
        } catch {
            return emptyOpenRouterUsageSnapshot()
        }
    }
    let lastUsageSnapshot = emptyOpenRouterUsageSnapshot()
    for (const line of trimmed.split(/\r?\n/)) {
        const stripped = line.trim()
        if (!stripped.startsWith('data:')) {
            continue
        }
        const payload = stripped.slice('data:'.length).trim()
        if (!payload || payload === '[DONE]') {
            continue
        }
        try {
            const usageSnapshot = openRouterUsageSnapshotFromProviderPayload(
                JSON.parse(payload) as unknown,
            )
            if (usageSnapshot && hasOpenRouterUsageSnapshotValue(usageSnapshot)) {
                lastUsageSnapshot = mergeOpenRouterUsageSnapshots(lastUsageSnapshot, usageSnapshot)
            }
        } catch {
            continue
        }
    }
    return lastUsageSnapshot
}

export function openRouterCostMicrosFromProviderText(text: string): number | null {
    return openRouterUsageSnapshotFromProviderText(text).costMicros
}
