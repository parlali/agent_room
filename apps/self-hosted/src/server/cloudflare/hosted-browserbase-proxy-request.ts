import { nullableObjectRecord } from './hosted-json'
import type { HostedBrowserbaseProxyPath } from './hosted-provider-proxy'
import { hostedJsonResponse } from './hosted-worker-response'

export type BrowserbaseProviderAction =
    | 'search'
    | 'create_session'
    | 'debug_session'
    | 'release_session'

export interface BrowserbaseProviderRequest {
    action: BrowserbaseProviderAction
    body: string | null
    sessionId: string | null
}

const browserbaseSearchBodyKeys = new Set(['query', 'numResults'])
const browserbaseSessionBodyKeys = new Set(['keepAlive', 'browserSettings'])
const browserbaseSessionSettingsKeys = new Set(['timeout'])
const browserbaseReleaseBodyKeys = new Set(['status'])

export function invalidManagedBrowserbaseRequest(): Response {
    return hostedJsonResponse(
        {
            ok: false,
            code: 'invalid_managed_browserbase_request',
        },
        {
            status: 400,
        },
    )
}

function hasOnlyKeys(record: Record<string, unknown>, allowed: ReadonlySet<string>): boolean {
    return Object.keys(record).every((key) => allowed.has(key))
}

async function readJsonRecord(request: Request): Promise<Record<string, unknown> | null> {
    try {
        return nullableObjectRecord(await request.json())
    } catch {
        return null
    }
}

function browserbaseSessionIdFromPath(targetPath: string): string | null {
    const match = targetPath.match(/^\/sessions\/([^/]+)(?:\/debug)?$/)
    if (!match) {
        return null
    }
    try {
        return decodeURIComponent(match[1]!)
    } catch {
        return null
    }
}

function canonicalBrowserbaseSearchBody(record: Record<string, unknown>): string | null {
    if (!hasOnlyKeys(record, browserbaseSearchBodyKeys)) {
        return null
    }
    const query = typeof record.query === 'string' ? record.query.trim() : ''
    const numResults =
        typeof record.numResults === 'number' && Number.isFinite(record.numResults)
            ? Math.max(1, Math.min(25, Math.trunc(record.numResults)))
            : null
    if (!query || numResults === null) {
        return null
    }
    return JSON.stringify({
        query,
        numResults,
    })
}

function canonicalBrowserbaseSessionBody(record: Record<string, unknown>): string | null {
    if (!hasOnlyKeys(record, browserbaseSessionBodyKeys)) {
        return null
    }
    if (record.keepAlive !== undefined && record.keepAlive !== true) {
        return null
    }
    const browserSettings = nullableObjectRecord(record.browserSettings)
    if (!browserSettings || !hasOnlyKeys(browserSettings, browserbaseSessionSettingsKeys)) {
        return null
    }
    const timeout =
        typeof browserSettings.timeout === 'number' && Number.isFinite(browserSettings.timeout)
            ? Math.max(60, Math.min(21600, Math.trunc(browserSettings.timeout)))
            : null
    if (timeout === null) {
        return null
    }
    return JSON.stringify({
        keepAlive: true,
        browserSettings: {
            timeout,
        },
    })
}

function canonicalBrowserbaseReleaseBody(record: Record<string, unknown>): string | null {
    if (!hasOnlyKeys(record, browserbaseReleaseBodyKeys) || record.status !== 'REQUEST_RELEASE') {
        return null
    }
    return JSON.stringify({
        status: 'REQUEST_RELEASE',
    })
}

export async function browserbaseProviderRequest(input: {
    request: Request
    url: URL
    proxyPath: HostedBrowserbaseProxyPath
}): Promise<BrowserbaseProviderRequest | Response> {
    if (input.url.search) {
        return invalidManagedBrowserbaseRequest()
    }
    if (input.proxyPath.targetPath === '/search') {
        const record = await readJsonRecord(input.request)
        const body = record ? canonicalBrowserbaseSearchBody(record) : null
        return body
            ? { action: 'search', body, sessionId: null }
            : invalidManagedBrowserbaseRequest()
    }
    if (input.proxyPath.targetPath === '/sessions') {
        const record = await readJsonRecord(input.request)
        const body = record ? canonicalBrowserbaseSessionBody(record) : null
        return body
            ? { action: 'create_session', body, sessionId: null }
            : invalidManagedBrowserbaseRequest()
    }
    const sessionId = browserbaseSessionIdFromPath(input.proxyPath.targetPath)
    if (!sessionId) {
        return invalidManagedBrowserbaseRequest()
    }
    if (input.proxyPath.targetPath.endsWith('/debug')) {
        return { action: 'debug_session', body: null, sessionId }
    }
    const record = await readJsonRecord(input.request)
    const body = record ? canonicalBrowserbaseReleaseBody(record) : null
    return body
        ? { action: 'release_session', body, sessionId }
        : invalidManagedBrowserbaseRequest()
}

export function browserbaseSessionIdFromProviderResponse(responseText: string): string | null {
    try {
        const record = nullableObjectRecord(JSON.parse(responseText))
        const id = typeof record?.id === 'string' ? record.id.trim() : ''
        return id || null
    } catch {
        return null
    }
}
