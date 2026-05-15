import { cdpCommandTimeoutMs } from './browserbase-browser-types'
import { asRecord } from './browserbase-utils'

const browserbaseApiBaseUrl = 'https://api.browserbase.com/v1'

export interface BrowserbaseSessionResponse {
    id: string
    connectUrl: string
}

export interface BrowserbaseDebugResponse {
    debuggerFullscreenUrl: string | null
    debuggerUrl: string | null
    pages: BrowserbaseDebugPage[]
}

interface BrowserbaseDebugPage {
    url: string | null
    title: string | null
    debuggerFullscreenUrl: string | null
    debuggerUrl: string | null
}

export async function createBrowserbaseSession(input: {
    apiKey: string
    timeoutSeconds: number
    signal?: AbortSignal
}): Promise<BrowserbaseSessionResponse> {
    const json = await browserbaseJsonRequest({
        apiKey: input.apiKey,
        url: `${browserbaseApiBaseUrl}/sessions`,
        method: 'POST',
        body: {
            keepAlive: true,
            timeout: input.timeoutSeconds,
        },
        signal: input.signal,
    })
    const record = asRecord(json)
    const id = typeof record?.id === 'string' ? record.id : null
    const connectUrl = typeof record?.connectUrl === 'string' ? record.connectUrl : null
    if (!id || !connectUrl) {
        throw new Error('Browserbase session response did not include an id and connectUrl')
    }
    return {
        id,
        connectUrl,
    }
}

export async function getBrowserbaseDebugUrls(input: {
    apiKey: string
    sessionId: string
    signal?: AbortSignal
}): Promise<BrowserbaseDebugResponse> {
    const json = await browserbaseJsonRequest({
        apiKey: input.apiKey,
        url: `${browserbaseApiBaseUrl}/sessions/${encodeURIComponent(input.sessionId)}/debug`,
        method: 'GET',
        signal: input.signal,
    })
    const record = asRecord(json)
    return {
        debuggerFullscreenUrl:
            typeof record?.debuggerFullscreenUrl === 'string' ? record.debuggerFullscreenUrl : null,
        debuggerUrl: typeof record?.debuggerUrl === 'string' ? record.debuggerUrl : null,
        pages: Array.isArray(record?.pages)
            ? record.pages
                  .map(parseDebugPage)
                  .filter((page): page is BrowserbaseDebugPage => page !== null)
            : [],
    }
}

export async function releaseBrowserbaseSession(input: {
    apiKey: string
    sessionId: string
    signal?: AbortSignal
}): Promise<void> {
    await browserbaseJsonRequest({
        apiKey: input.apiKey,
        url: `${browserbaseApiBaseUrl}/sessions/${encodeURIComponent(input.sessionId)}`,
        method: 'POST',
        body: {
            status: 'REQUEST_RELEASE',
        },
        signal: input.signal,
    })
}

export function browserbaseTimeoutSeconds(idleTimeoutMs: number): number {
    return Math.min(21600, Math.max(60, Math.ceil(idleTimeoutMs / 1000) + 60))
}

export function bestLiveUrl(debug: BrowserbaseDebugResponse): string | null {
    return (
        debug.debuggerFullscreenUrl ??
        debug.pages.find((page) => page.debuggerFullscreenUrl)?.debuggerFullscreenUrl ??
        debug.debuggerUrl ??
        debug.pages.find((page) => page.debuggerUrl)?.debuggerUrl ??
        null
    )
}

async function browserbaseJsonRequest(input: {
    apiKey: string
    url: string
    method: 'GET' | 'POST'
    body?: unknown
    signal?: AbortSignal
}): Promise<unknown> {
    const response = await fetchWithAbort({
        url: input.url,
        signal: input.signal,
        init: {
            method: input.method,
            headers: {
                accept: 'application/json',
                'content-type': 'application/json',
                'user-agent': 'AgentRoom/1.0',
                'x-bb-api-key': input.apiKey,
            },
            body: input.body === undefined ? undefined : JSON.stringify(input.body),
        },
    })
    if (!response.ok) {
        throw new Error(browserbaseHttpErrorMessage(response.status))
    }
    const text = await readBrowserbaseResponseTextWithAbort({
        response,
        signal: input.signal,
    })
    if (!text.trim()) {
        return null
    }
    try {
        return JSON.parse(text)
    } catch {
        throw new Error('Browserbase returned invalid JSON')
    }
}

async function readBrowserbaseResponseTextWithAbort(input: {
    response: Response
    signal?: AbortSignal
}): Promise<string> {
    const body = input.response.body
    if (!body) {
        return ''
    }
    const reader = body.getReader()
    const decoder = new TextDecoder()
    let timedOut = false
    let interrupted = false
    let rejectRead: ((error: Error) => void) | null = null
    const abortPromise = new Promise<never>((_resolve, reject) => {
        rejectRead = reject
    })
    const interruptRead = (message: string, timeout: boolean) => {
        if (interrupted) return
        interrupted = true
        timedOut = timeout
        reader.cancel().catch(() => undefined)
        rejectRead?.(new Error(message))
    }
    const timeout = setTimeout(() => {
        interruptRead('Browserbase response body timed out', true)
    }, cdpCommandTimeoutMs)
    timeout.unref?.()
    const abort = () => {
        interruptRead('Browser action was cancelled', false)
    }
    input.signal?.addEventListener('abort', abort, { once: true })
    if (input.signal?.aborted) {
        abort()
    }

    try {
        let text = ''
        while (true) {
            const chunk = await Promise.race([reader.read(), abortPromise])
            if (chunk.done) {
                break
            }
            text += decoder.decode(chunk.value, { stream: true })
        }
        text += decoder.decode()
        interrupted = true
        return text
    } catch (error) {
        if (error instanceof Error) {
            if (
                error.message === 'Browser action was cancelled' ||
                error.message === 'Browserbase response body timed out'
            ) {
                throw error
            }
        }
        throw new Error(
            timedOut ? 'Browserbase response body timed out' : 'Browserbase response body failed',
        )
    } finally {
        input.signal?.removeEventListener('abort', abort)
        clearTimeout(timeout)
        try {
            reader.releaseLock()
        } catch {}
    }
}

async function fetchWithAbort(input: {
    url: string
    init: RequestInit
    signal?: AbortSignal
}): Promise<Response> {
    const controller = new AbortController()
    let timedOut = false
    const timeout = setTimeout(() => {
        timedOut = true
        controller.abort()
    }, cdpCommandTimeoutMs)
    timeout.unref?.()
    const abort = () => controller.abort()
    input.signal?.addEventListener('abort', abort, { once: true })
    if (input.signal?.aborted) {
        abort()
    }
    try {
        return await fetch(input.url, {
            ...input.init,
            signal: controller.signal,
        })
    } catch (error) {
        if (controller.signal.aborted) {
            throw new Error(
                timedOut ? 'Browserbase request timed out' : 'Browser action was cancelled',
            )
        }
        throw error
    } finally {
        input.signal?.removeEventListener('abort', abort)
        clearTimeout(timeout)
    }
}

function browserbaseHttpErrorMessage(status: number): string {
    if (status === 401) {
        return 'Browserbase authentication failed'
    }
    if (status === 402 || status === 403) {
        return 'Browserbase rejected the session request for this account'
    }
    if (status === 408 || status === 504) {
        return 'Browserbase request timed out'
    }
    if (status === 429) {
        return 'Browserbase session limit or rate limit was reached'
    }
    return `Browserbase API request failed with status ${status}`
}

function parseDebugPage(value: unknown): BrowserbaseDebugPage | null {
    const record = asRecord(value)
    if (!record) {
        return null
    }
    return {
        url: typeof record.url === 'string' ? record.url : null,
        title: typeof record.title === 'string' ? record.title : null,
        debuggerFullscreenUrl:
            typeof record.debuggerFullscreenUrl === 'string' ? record.debuggerFullscreenUrl : null,
        debuggerUrl: typeof record.debuggerUrl === 'string' ? record.debuggerUrl : null,
    }
}
