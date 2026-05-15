import type { PiRuntimeConfig } from '../rooms/pi-runtime-config'
import {
    assertNonEmptyResults,
    delay,
    fetchWithTimeout,
    isPublicHttpUrl,
    normalizeHtmlText,
    responseError,
    SearchProviderError,
    type SearchProvider,
    type SearchProviderResponse,
    type SearchProviderSearchInput,
    type WebSearchResult,
} from './web-search'

const browserbaseApiBaseUrl = 'https://api.browserbase.com/v1'
const browserSearchUrl = 'https://search.brave.com/search'

interface BrowserbaseSessionRecord {
    id: string
    connectUrl: string
}

interface BrowserExtractedResult {
    title: string
    url: string
    snippet: string
}

interface CdpResponse<T> {
    id?: number
    method?: string
    params?: unknown
    result?: T
    error?: {
        message?: string
    }
    sessionId?: string
}

export class BrowserbaseSearchProvider implements SearchProvider {
    id = 'browserbase' as const
    label = 'Browserbase Browser Search'
    priority = 20

    isConfigured(config: PiRuntimeConfig): boolean {
        const envKey = config.search.browserbase.envKey
        return (
            config.search.browserbase.enabled &&
            Boolean(config.search.browserbase.projectId) &&
            Boolean(envKey && process.env[envKey])
        )
    }

    async search(input: SearchProviderSearchInput): Promise<SearchProviderResponse> {
        const envKey = input.config.search.browserbase.envKey
        const apiKey = envKey ? process.env[envKey] : null
        const projectId = input.config.search.browserbase.projectId
        if (!apiKey || !projectId) {
            throw new SearchProviderError({
                code: 'misconfigured',
                providerId: this.id,
                message: 'Browserbase API key and project ID are required',
            })
        }

        const timeoutMs = input.config.search.browserbase.timeoutMs
        const session = await createBrowserbaseSession({
            apiKey,
            projectId,
            timeoutMs,
            signal: input.signal,
        })
        try {
            const extracted = await runBrowserMediatedSearch({
                connectUrl: session.connectUrl,
                query: input.query,
                count: input.count,
                timeoutMs,
                signal: input.signal,
            })
            const results = parseBrowserExtractedSearchResults(
                extracted,
                new Date().toISOString(),
            ).slice(0, input.count)
            assertNonEmptyResults(this.id, results)
            return {
                results,
                backendFormat: 'browser',
                fallbackReason: null,
                degradedReason: null,
                browserMediated: true,
            }
        } finally {
            await releaseBrowserbaseSession({
                apiKey,
                projectId,
                sessionId: session.id,
                timeoutMs,
            }).catch(() => undefined)
        }
    }
}

async function createBrowserbaseSession(input: {
    apiKey: string
    projectId: string
    timeoutMs: number
    signal?: AbortSignal
}): Promise<BrowserbaseSessionRecord> {
    const response = await fetchWithTimeout({
        providerId: 'browserbase',
        timeoutMs: input.timeoutMs,
        signal: input.signal,
        url: `${browserbaseApiBaseUrl}/sessions`,
        init: {
            method: 'POST',
            headers: {
                accept: 'application/json',
                'content-type': 'application/json',
                'x-bb-api-key': input.apiKey,
            },
            body: JSON.stringify({
                projectId: input.projectId,
                browserSettings: {
                    timeout: Math.max(60, Math.ceil(input.timeoutMs / 1000)),
                },
            }),
        },
    })
    if (!response.ok) {
        throw await responseError({
            providerId: 'browserbase',
            response,
        })
    }
    const record: unknown = await response.json()
    if (
        !record ||
        typeof record !== 'object' ||
        typeof (record as { id?: unknown }).id !== 'string' ||
        typeof (record as { connectUrl?: unknown }).connectUrl !== 'string'
    ) {
        throw new SearchProviderError({
            code: 'bad_response',
            providerId: 'browserbase',
            retryable: true,
            message: 'Browserbase session response did not include a connection URL',
        })
    }
    return {
        id: (record as { id: string }).id,
        connectUrl: (record as { connectUrl: string }).connectUrl,
    }
}

async function releaseBrowserbaseSession(input: {
    apiKey: string
    projectId: string
    sessionId: string
    timeoutMs: number
}): Promise<void> {
    await fetchWithTimeout({
        providerId: 'browserbase',
        timeoutMs: Math.min(5_000, input.timeoutMs),
        url: `${browserbaseApiBaseUrl}/sessions/${encodeURIComponent(input.sessionId)}`,
        init: {
            method: 'POST',
            headers: {
                accept: 'application/json',
                'content-type': 'application/json',
                'x-bb-api-key': input.apiKey,
            },
            body: JSON.stringify({
                status: 'REQUEST_RELEASE',
                projectId: input.projectId,
            }),
        },
    })
}

export function parseBrowserExtractedSearchResults(
    value: unknown,
    fetchedAt: string,
): WebSearchResult[] {
    if (!Array.isArray(value)) return []
    return value
        .map((entry, index): WebSearchResult | null => {
            if (!entry || typeof entry !== 'object') return null
            const record = entry as Record<string, unknown>
            const title = typeof record.title === 'string' ? normalizeHtmlText(record.title) : ''
            const url = typeof record.url === 'string' ? record.url.trim() : ''
            const snippet =
                typeof record.snippet === 'string' ? normalizeHtmlText(record.snippet) : ''
            if (!title || !isPublicHttpUrl(url)) return null
            return {
                title,
                url,
                snippet,
                engine: 'browserbase:brave',
                fetchedAt,
                rank: index + 1,
            }
        })
        .filter((entry): entry is WebSearchResult => entry !== null)
}

async function runBrowserMediatedSearch(input: {
    connectUrl: string
    query: string
    count: number
    timeoutMs: number
    signal?: AbortSignal
}): Promise<BrowserExtractedResult[]> {
    const client = await CdpClient.connect(input.connectUrl, input.timeoutMs, input.signal)
    try {
        const targetId = await client.resolvePageTarget()
        const attached = await client.send<{ sessionId: string }>('Target.attachToTarget', {
            targetId,
            flatten: true,
        })
        const sessionId = attached.sessionId
        await client.send('Page.enable', {}, sessionId)
        await client.send('Runtime.enable', {}, sessionId)
        const url = new URL(browserSearchUrl)
        url.searchParams.set('q', input.query.trim())
        url.searchParams.set('source', 'web')
        const load = client.waitForEvent('Page.loadEventFired', sessionId, input.timeoutMs)
        await client.send('Page.navigate', { url: url.toString() }, sessionId)
        await load.catch(() => undefined)
        await waitForBrowserDocument(client, sessionId, input.timeoutMs)
        const response = await client.send<{
            result?: {
                value?: unknown
            }
            exceptionDetails?: unknown
        }>(
            'Runtime.evaluate',
            {
                expression: browserSearchExtractionScript(input.count),
                returnByValue: true,
                awaitPromise: true,
            },
            sessionId,
        )
        if (response.exceptionDetails) {
            throw new SearchProviderError({
                code: 'bad_response',
                providerId: 'browserbase',
                retryable: true,
                message: 'Browser-mediated search extraction failed',
            })
        }
        const value = response.result?.value
        return Array.isArray(value) ? (value as BrowserExtractedResult[]) : []
    } finally {
        await client.close()
    }
}

async function waitForBrowserDocument(
    client: CdpClient,
    sessionId: string,
    timeoutMs: number,
): Promise<void> {
    const startedAt = Date.now()
    while (Date.now() - startedAt < timeoutMs) {
        const response = await client
            .send<{ result?: { value?: unknown } }>(
                'Runtime.evaluate',
                {
                    expression: 'document.readyState',
                    returnByValue: true,
                },
                sessionId,
            )
            .catch(() => null)
        const value = response?.result?.value
        if (value === 'interactive' || value === 'complete') {
            return
        }
        await delay(200)
    }
    throw new SearchProviderError({
        code: 'timeout',
        providerId: 'browserbase',
        retryable: true,
        message: 'Browser-mediated search page did not become ready',
    })
}

function browserSearchExtractionScript(count: number): string {
    return `(() => {
        const limit = ${Math.max(1, Math.min(20, Math.floor(count)))}
        const blockedHosts = new Set(['search.brave.com', 'brave.com'])
        const seen = new Set()
        const results = []
        for (const anchor of Array.from(document.querySelectorAll('a[href]'))) {
            const rawHref = anchor.getAttribute('href') || ''
            let url
            try {
                url = new URL(rawHref, document.location.href)
            } catch {
                continue
            }
            if (url.protocol !== 'http:' && url.protocol !== 'https:') continue
            if (blockedHosts.has(url.hostname.replace(/^www\\./, ''))) continue
            const title = (anchor.textContent || '').replace(/\\s+/g, ' ').trim()
            if (title.length < 3 || seen.has(url.href)) continue
            const container = anchor.closest('article, section, div')
            const snippet = (container?.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 500)
            seen.add(url.href)
            results.push({ title, url: url.href, snippet })
            if (results.length >= limit) break
        }
        return results
    })()`
}

class CdpClient {
    private ws: WebSocket
    private timeoutMs: number
    private signal?: AbortSignal
    private nextId = 1
    private pending = new Map<
        number,
        {
            resolve: (value: unknown) => void
            reject: (error: Error) => void
        }
    >()
    private eventWaiters: Array<{
        method: string
        sessionId: string | null
        resolve: (value: unknown) => void
        reject: (error: Error) => void
    }> = []

    private constructor(ws: WebSocket, timeoutMs: number, signal?: AbortSignal) {
        this.ws = ws
        this.timeoutMs = timeoutMs
        this.signal = signal
        this.ws.addEventListener('message', (event) => this.onMessage(event))
        this.ws.addEventListener('close', () => this.rejectPending('Browserbase CDP socket closed'))
        this.ws.addEventListener('error', () =>
            this.rejectPending('Browserbase CDP socket errored'),
        )
    }

    static connect(url: string, timeoutMs: number, signal?: AbortSignal): Promise<CdpClient> {
        return new Promise((resolve, reject) => {
            const ws = new WebSocket(url)
            let settled = false
            let timeout: ReturnType<typeof setTimeout> | null = null
            const abort = () => {
                if (settled) return
                settled = true
                if (timeout) {
                    clearTimeout(timeout)
                }
                ws.close()
                reject(browserbaseTimeoutError('Browserbase CDP connection aborted'))
            }
            timeout = setTimeout(() => {
                if (settled) return
                settled = true
                signal?.removeEventListener('abort', abort)
                ws.close()
                reject(browserbaseTimeoutError('Browserbase CDP connection timed out'))
            }, timeoutMs)
            timeout.unref?.()
            signal?.addEventListener('abort', abort, { once: true })
            if (signal?.aborted) {
                abort()
                return
            }
            ws.addEventListener('open', () => {
                if (settled) return
                settled = true
                clearTimeout(timeout)
                signal?.removeEventListener('abort', abort)
                resolve(new CdpClient(ws, timeoutMs, signal))
            })
            ws.addEventListener('error', () => {
                if (settled) return
                settled = true
                clearTimeout(timeout)
                signal?.removeEventListener('abort', abort)
                reject(
                    new SearchProviderError({
                        code: 'bad_response',
                        providerId: 'browserbase',
                        retryable: true,
                        message: 'Browserbase CDP connection failed',
                    }),
                )
            })
        })
    }

    async resolvePageTarget(): Promise<string> {
        const targets = await this.send<{
            targetInfos?: Array<{
                targetId: string
                type: string
                url?: string
            }>
        }>('Target.getTargets')
        const page = targets.targetInfos?.find((target) => target.type === 'page')
        if (page) {
            return page.targetId
        }
        const created = await this.send<{ targetId: string }>('Target.createTarget', {
            url: 'about:blank',
        })
        return created.targetId
    }

    send<T>(
        method: string,
        params: Record<string, unknown> = {},
        sessionId?: string,
        timeoutMs = this.timeoutMs,
    ): Promise<T> {
        if (this.signal?.aborted) {
            return Promise.reject(
                browserbaseTimeoutError(`Browserbase CDP command ${method} aborted`),
            )
        }
        if (this.ws.readyState !== WebSocket.OPEN) {
            return Promise.reject(
                new SearchProviderError({
                    code: 'bad_response',
                    providerId: 'browserbase',
                    retryable: true,
                    message: `Browserbase CDP command ${method} could not be sent`,
                }),
            )
        }
        const id = this.nextId
        this.nextId += 1
        const payload = JSON.stringify({
            id,
            method,
            params,
            ...(sessionId ? { sessionId } : {}),
        })
        return new Promise<T>((resolve, reject) => {
            let settled = false
            let timeout: ReturnType<typeof setTimeout> | null = null
            let abort: () => void = () => undefined
            const cleanup = () => {
                if (timeout) {
                    clearTimeout(timeout)
                }
                this.signal?.removeEventListener('abort', abort)
                this.pending.delete(id)
            }
            const settleReject = (error: Error) => {
                if (settled) return
                settled = true
                cleanup()
                reject(error)
            }
            const settleResolve = (value: unknown) => {
                if (settled) return
                settled = true
                cleanup()
                resolve(value as T)
            }
            abort = () =>
                settleReject(browserbaseTimeoutError(`Browserbase CDP command ${method} aborted`))
            timeout = setTimeout(
                () =>
                    settleReject(
                        browserbaseTimeoutError(`Browserbase CDP command ${method} timed out`),
                    ),
                timeoutMs,
            )
            timeout.unref?.()
            this.signal?.addEventListener('abort', abort, { once: true })
            this.pending.set(id, {
                resolve: settleResolve,
                reject: settleReject,
            })
            try {
                this.ws.send(payload)
            } catch {
                settleReject(
                    new SearchProviderError({
                        code: 'bad_response',
                        providerId: 'browserbase',
                        retryable: true,
                        message: `Browserbase CDP command ${method} failed`,
                    }),
                )
            }
        })
    }

    waitForEvent(method: string, sessionId: string | null, timeoutMs: number): Promise<unknown> {
        return new Promise((resolve, reject) => {
            let settled = false
            let timeout: ReturnType<typeof setTimeout> | null = null
            let abort: () => void = () => undefined
            const settleReject = (error: Error) => {
                if (settled) return
                settled = true
                cleanup()
                reject(error)
            }
            const settleResolve = (value: unknown) => {
                if (settled) return
                settled = true
                cleanup()
                resolve(value)
            }
            const waiter = {
                method,
                sessionId,
                resolve: (value: unknown) => settleResolve(value),
                reject: (error: Error) => settleReject(error),
            }
            const cleanup = () => {
                if (timeout) {
                    clearTimeout(timeout)
                }
                this.signal?.removeEventListener('abort', abort)
                this.eventWaiters = this.eventWaiters.filter((entry) => entry !== waiter)
            }
            abort = () => settleReject(browserbaseTimeoutError(`Timed out waiting for ${method}`))
            this.eventWaiters.push(waiter)
            timeout = setTimeout(
                () => settleReject(browserbaseTimeoutError(`Timed out waiting for ${method}`)),
                timeoutMs,
            )
            timeout.unref?.()
            this.signal?.addEventListener('abort', abort, { once: true })
            if (this.signal?.aborted) {
                abort()
            }
        })
    }

    async close(): Promise<void> {
        try {
            if (this.ws.readyState === WebSocket.OPEN) {
                await this.send(
                    'Browser.close',
                    {},
                    undefined,
                    Math.min(1_000, this.timeoutMs),
                ).catch(() => undefined)
            }
        } finally {
            this.ws.close()
            this.rejectPending('Browserbase CDP socket closed')
        }
    }

    private onMessage(event: MessageEvent): void {
        const data = typeof event.data === 'string' ? event.data : String(event.data)
        let parsed: CdpResponse<unknown>
        try {
            parsed = JSON.parse(data) as CdpResponse<unknown>
        } catch {
            return
        }
        if (typeof parsed.id === 'number') {
            const pending = this.pending.get(parsed.id)
            if (!pending) return
            if (parsed.error) {
                pending.reject(
                    new SearchProviderError({
                        code: 'bad_response',
                        providerId: 'browserbase',
                        retryable: true,
                        message: 'Browserbase CDP command failed',
                    }),
                )
            } else {
                pending.resolve(parsed.result ?? {})
            }
            return
        }
        if (parsed.method) {
            const waiter = this.eventWaiters.find(
                (entry) =>
                    entry.method === parsed.method &&
                    (!entry.sessionId || entry.sessionId === parsed.sessionId),
            )
            if (waiter) {
                waiter.resolve(parsed.params ?? {})
            }
        }
    }

    private rejectPending(message: string): void {
        const pending = [...this.pending.values()]
        const waiters = [...this.eventWaiters]
        this.pending.clear()
        this.eventWaiters = []
        for (const entry of pending) {
            entry.reject(
                new SearchProviderError({
                    code: 'bad_response',
                    providerId: 'browserbase',
                    retryable: true,
                    message,
                }),
            )
        }
        for (const waiter of waiters) {
            waiter.reject(
                new SearchProviderError({
                    code: 'bad_response',
                    providerId: 'browserbase',
                    retryable: true,
                    message,
                }),
            )
        }
    }
}

function browserbaseTimeoutError(message: string): SearchProviderError {
    return new SearchProviderError({
        code: 'timeout',
        providerId: 'browserbase',
        retryable: true,
        message,
    })
}
