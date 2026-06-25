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
    allowedPaths: Set<string>,
): {
    targetPath: (suffix: string) => string | null
    parse: (pathname: string) => HostedProxyPath | null
} {
    const targetPath = (suffix: string): string | null => {
        const path = suffix.startsWith('/') ? suffix : `/${suffix}`
        return allowedPaths.has(path) ? path : null
    }
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

const hostedOpenRouterProxyPathHelpers = makeHostedProxyPathHelpers(
    hostedOpenRouterProxyPathPrefix,
    hostedOpenRouterProxyAllowedPaths,
)
const hostedBraveProxyPathHelpers = makeHostedProxyPathHelpers(
    hostedBraveProxyPathPrefix,
    hostedBraveProxyAllowedPaths,
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

function parseHostedBrowserbaseProxyPath(pathname: string): HostedBrowserbaseProxyPath | null {
    if (!pathname.startsWith(hostedBrowserbaseProxyPathPrefix)) {
        return null
    }
    const suffix = pathname.slice(hostedBrowserbaseProxyPathPrefix.length)
    const match = suffix.match(/^\/workspaces\/([^/]+)\/rooms\/([^/]+)(\/.*)$/)
    if (!match) {
        return null
    }
    const resolved = browserbaseTargetPath(match[3]!)
    if (!resolved) {
        return null
    }
    return {
        workspaceId: decodeURIComponent(match[1]!),
        roomId: decodeURIComponent(match[2]!),
        targetPath: resolved,
    }
}

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
export const parseHostedOpenRouterProxyPath = hostedOpenRouterProxyPathHelpers.parse
export const parseHostedBraveProxyPath = hostedBraveProxyPathHelpers.parse
export {
    browserbaseTargetPath as hostedBrowserbaseProxyTargetPath,
    parseHostedBrowserbaseProxyPath,
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

export function openRouterCostMicrosFromProviderPayload(value: unknown): number | null {
    const record = nullableObjectRecord(value)
    if (!record) {
        return null
    }
    const usage = nullableObjectRecord(record.usage)
    if (!usage) {
        return null
    }
    return openRouterCostMicrosFromDollars(usage.cost)
}

export function openRouterCostMicrosFromProviderText(text: string): number | null {
    const trimmed = text.trim()
    if (!trimmed) {
        return null
    }
    if (!trimmed.includes('\ndata:') && !trimmed.startsWith('data:')) {
        try {
            return openRouterCostMicrosFromProviderPayload(JSON.parse(trimmed) as unknown)
        } catch {
            return null
        }
    }
    let lastCostMicros: number | null = null
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
            const costMicros = openRouterCostMicrosFromProviderPayload(
                JSON.parse(payload) as unknown,
            )
            if (costMicros !== null) {
                lastCostMicros = costMicros
            }
        } catch {
            continue
        }
    }
    return lastCostMicros
}
