import { assertSafeUrl } from './web-url-safety'
import { fetchPublicTextUrl, type FetchResult } from '../web/web-fetch-core'

export type { FetchResult } from '../web/web-fetch-core'

export async function fetchUrl(input: {
    url: string
    timeoutMs: number
    signal?: AbortSignal
}): Promise<FetchResult> {
    return fetchPublicTextUrl({
        ...input,
        assertSafeUrl,
    })
}

export async function fetchManagedUrl(input: {
    proxyUrl: string
    tokenEnvKey: string
    url: string
    timeoutMs: number
    signal?: AbortSignal
}): Promise<FetchResult> {
    const token = process.env[input.tokenEnvKey]
    if (!token) {
        throw new Error('Managed URL fetch token is not materialized')
    }
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), input.timeoutMs)
    timeout.unref?.()
    const abort = () => controller.abort()
    input.signal?.addEventListener('abort', abort, { once: true })
    if (input.signal?.aborted) {
        abort()
    }
    try {
        const response = await fetch(input.proxyUrl, {
            method: 'POST',
            headers: {
                accept: 'application/json',
                authorization: `Bearer ${token}`,
                'content-type': 'application/json',
            },
            body: JSON.stringify({
                url: input.url,
                timeoutMs: input.timeoutMs,
            }),
            signal: controller.signal,
        })
        const text = await response.text()
        if (!response.ok) {
            throw new Error(managedFetchErrorMessage(response.status, text))
        }
        let parsed: unknown
        try {
            parsed = JSON.parse(text) as unknown
        } catch {
            throw new Error('Managed URL fetch returned invalid JSON')
        }
        return parseManagedFetchResult(parsed)
    } catch (error) {
        if (controller.signal.aborted) {
            throw new Error('Managed URL fetch timed out or was cancelled')
        }
        throw error
    } finally {
        input.signal?.removeEventListener('abort', abort)
        clearTimeout(timeout)
    }
}

function parseManagedFetchResult(value: unknown): FetchResult {
    const record =
        value && typeof value === 'object' && !Array.isArray(value)
            ? (value as Record<string, unknown>)
            : null
    if (!record) {
        throw new Error('Managed URL fetch response was not an object')
    }
    if (
        typeof record.url !== 'string' ||
        typeof record.finalUrl !== 'string' ||
        typeof record.status !== 'number' ||
        typeof record.contentType !== 'string' ||
        typeof record.text !== 'string' ||
        typeof record.byteLength !== 'number' ||
        typeof record.truncated !== 'boolean'
    ) {
        throw new Error('Managed URL fetch response was incomplete')
    }
    return {
        url: record.url,
        finalUrl: record.finalUrl,
        status: record.status,
        contentType: record.contentType,
        title: typeof record.title === 'string' ? record.title : null,
        text: record.text,
        byteLength: record.byteLength,
        truncated: record.truncated,
    }
}

function managedFetchErrorMessage(status: number, text: string): string {
    const trimmed = text.trim()
    if (!trimmed) {
        return `Managed URL fetch failed with status ${status}`
    }
    try {
        const parsed = JSON.parse(trimmed) as unknown
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            const record = parsed as Record<string, unknown>
            if (typeof record.message === 'string' && record.message.trim()) {
                return record.message.trim()
            }
            if (typeof record.code === 'string' && record.code.trim()) {
                return `Managed URL fetch failed: ${record.code.trim()}`
            }
        }
    } catch {}
    return `Managed URL fetch failed with status ${status}`
}
