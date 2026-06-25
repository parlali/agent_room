import { nullableObjectRecord } from './hosted-json'

export const hostedOpenRouterProxyPathPrefix = '/api/hosted/runtime/provider/openrouter/v1'
const hostedOpenRouterProxyAllowedPaths = new Set(['/chat/completions'])
export const hostedBraveProxyPathPrefix = '/api/hosted/runtime/provider/brave/v1'
const hostedBraveProxyAllowedPaths = new Set(['/res/v1/web/search'])

export interface HostedOpenRouterProxyPath {
    workspaceId: string
    roomId: string
    targetPath: string
}

export interface HostedBraveProxyPath {
    workspaceId: string
    roomId: string
    targetPath: string
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

export function hostedOpenRouterProxyTargetPath(suffix: string): string | null {
    const path = suffix.startsWith('/') ? suffix : `/${suffix}`
    return hostedOpenRouterProxyAllowedPaths.has(path) ? path : null
}

export function hostedBraveProxyTargetPath(suffix: string): string | null {
    const path = suffix.startsWith('/') ? suffix : `/${suffix}`
    return hostedBraveProxyAllowedPaths.has(path) ? path : null
}

export function parseHostedOpenRouterProxyPath(pathname: string): HostedOpenRouterProxyPath | null {
    if (!pathname.startsWith(hostedOpenRouterProxyPathPrefix)) {
        return null
    }
    const suffix = pathname.slice(hostedOpenRouterProxyPathPrefix.length)
    const match = suffix.match(/^\/workspaces\/([^/]+)\/rooms\/([^/]+)(\/.*)$/)
    if (!match) {
        return null
    }
    const targetPath = hostedOpenRouterProxyTargetPath(match[3]!)
    if (!targetPath) {
        return null
    }
    return {
        workspaceId: decodeURIComponent(match[1]!),
        roomId: decodeURIComponent(match[2]!),
        targetPath,
    }
}

export function parseHostedBraveProxyPath(pathname: string): HostedBraveProxyPath | null {
    if (!pathname.startsWith(hostedBraveProxyPathPrefix)) {
        return null
    }
    const suffix = pathname.slice(hostedBraveProxyPathPrefix.length)
    const match = suffix.match(/^\/workspaces\/([^/]+)\/rooms\/([^/]+)(\/.*)$/)
    if (!match) {
        return null
    }
    const targetPath = hostedBraveProxyTargetPath(match[3]!)
    if (!targetPath) {
        return null
    }
    return {
        workspaceId: decodeURIComponent(match[1]!),
        roomId: decodeURIComponent(match[2]!),
        targetPath,
    }
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
