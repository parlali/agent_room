import type { SearchErrorCode, SearchProviderId } from '../domain/types'
import type { PiRuntimeConfig } from '../rooms/pi-runtime-config'

export type SearchBackendFormat = 'json' | 'html' | 'api' | 'browser'

export interface WebSearchResult {
    title: string
    url: string
    snippet: string
    engine: string | null
    fetchedAt: string
    rank: number
}

export interface WebSearchResponse {
    results: WebSearchResult[]
    backendFormat: SearchBackendFormat
    fallbackReason: string | null
}

export interface SearchProviderSearchInput {
    config: PiRuntimeConfig
    query: string
    count: number
    language?: string | null
    freshness?: string | null
    safeSearch?: string | null
    location?: string | null
    disabledEngines?: string[]
    signal?: AbortSignal
}

export interface SearchEngineFailure {
    engine: string
    code: SearchErrorCode
    reason: string
}

export interface SearchProviderResponse extends WebSearchResponse {
    degradedReason: string | null
    browserMediated: boolean
    engineFailures?: SearchEngineFailure[]
}

export interface SearchProvider {
    id: SearchProviderId
    label: string
    priority: number
    isConfigured: (config: PiRuntimeConfig) => boolean
    search: (input: SearchProviderSearchInput) => Promise<SearchProviderResponse>
}

export interface SearchFallbackStep {
    backend: SearchProviderId
    backendLabel: string
    status: 'skipped' | 'selected' | 'retrying' | 'failed' | 'complete'
    attempts: number
    errorCode: SearchErrorCode | null
    reason: string | null
}

export interface RoutedWebSearchResponse extends WebSearchResponse {
    backend: SearchProviderId
    backendLabel: string
    fallbackChain: SearchFallbackStep[]
    degraded: boolean
    degradedReason: string | null
    resultCount: number
    browserMediated: boolean
}

export type SearchAudit = (event: string, payload: unknown) => Promise<void>

const maxDomainFilters = 50

export class SearchProviderError extends Error {
    code: SearchErrorCode
    providerId: SearchProviderId | null
    retryable: boolean
    status: number | null

    constructor(input: {
        code: SearchErrorCode
        message: string
        providerId?: SearchProviderId | null
        retryable?: boolean
        status?: number | null
    }) {
        super(input.message)
        this.name = 'SearchProviderError'
        this.code = input.code
        this.providerId = input.providerId ?? null
        this.retryable = input.retryable ?? false
        this.status = input.status ?? null
    }
}

export function normalizeStringArray(value: unknown): string[] {
    if (!Array.isArray(value)) {
        return []
    }
    return value
        .filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
        .map((entry) => entry.trim().toLowerCase())
        .slice(0, maxDomainFilters)
}

function domainMatches(hostname: string, domain: string): boolean {
    const normalizedHost = hostname.toLowerCase().replace(/\.$/, '')
    const normalizedDomain = domain.toLowerCase().replace(/^\*\./, '').replace(/\.$/, '')
    return normalizedHost === normalizedDomain || normalizedHost.endsWith(`.${normalizedDomain}`)
}

export function filterResultsByDomain(input: {
    results: WebSearchResult[]
    allowedDomains: string[]
    blockedDomains: string[]
}): WebSearchResult[] {
    return input.results.filter((result) => {
        let hostname = ''
        try {
            hostname = new URL(result.url).hostname
        } catch {
            return false
        }
        if (input.blockedDomains.some((domain) => domainMatches(hostname, domain))) {
            return false
        }
        return (
            input.allowedDomains.length === 0 ||
            input.allowedDomains.some((domain) => domainMatches(hostname, domain))
        )
    })
}

export function normalizeHtmlText(value: string): string {
    return value.replace(/\s+/g, ' ').trim()
}

export function searchHeaders(format: 'json' | 'html'): HeadersInit {
    return {
        accept: format === 'json' ? 'application/json' : 'text/html',
        'accept-language': 'en-US,en;q=0.9',
        'user-agent': 'AgentRoom/1.0',
    }
}

async function responseText(response: Response): Promise<string> {
    return response.text().catch(() => '')
}

function boundedResponseText(text: string): string {
    return normalizeHtmlText(text).slice(0, 160)
}

export async function responseError(input: {
    providerId: SearchProviderId
    response: Response
}): Promise<SearchProviderError> {
    const text = await responseText(input.response)
    return classifySearchHttpError({
        providerId: input.providerId,
        status: input.response.status,
        text: boundedResponseText(text),
    })
}

function classifySearchHttpError(input: {
    providerId: SearchProviderId
    status: number
    text: string
}): SearchProviderError {
    const lower = input.text.toLowerCase()
    if (input.status === 429) {
        return httpSearchError(input.providerId, 'rate_limited', input.status, false)
    }
    if (input.status === 408 || input.status === 504) {
        return httpSearchError(input.providerId, 'timeout', input.status, true)
    }
    if (lower.includes('captcha')) {
        return httpSearchError(input.providerId, 'captcha', input.status, false)
    }
    if (
        input.status === 401 ||
        lower.includes('invalid api key') ||
        lower.includes('unauthorized') ||
        lower.includes('not enabled')
    ) {
        return httpSearchError(input.providerId, 'misconfigured', input.status, false)
    }
    if (
        input.status === 402 ||
        input.status === 403 ||
        lower.includes('quota') ||
        lower.includes('billing') ||
        lower.includes('blocked') ||
        lower.includes('forbidden')
    ) {
        return httpSearchError(input.providerId, 'blocked', input.status, false)
    }
    return httpSearchError(input.providerId, 'bad_response', input.status, input.status >= 500)
}

function httpSearchError(
    providerId: SearchProviderId,
    code: SearchErrorCode,
    status: number | null,
    retryable: boolean,
): SearchProviderError {
    return new SearchProviderError({
        code,
        providerId,
        retryable,
        status,
        message: searchErrorMessage(providerId, code, status),
    })
}

function searchErrorMessage(
    providerId: SearchProviderId,
    code: SearchErrorCode,
    status: number | null,
): string {
    const statusText = status ? ` returned ${status}` : ' failed'
    return `${providerId} search ${code.replaceAll('_', ' ')}${statusText}`
}

function isAbortError(error: unknown): boolean {
    if (!error || typeof error !== 'object') {
        return false
    }
    return String((error as { name?: unknown }).name ?? '').toLowerCase() === 'aborterror'
}

export async function fetchWithTimeout(input: {
    url: URL | string
    init: RequestInit
    timeoutMs: number
    signal?: AbortSignal
    providerId: SearchProviderId
}): Promise<Response> {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), input.timeoutMs)
    timeout.unref?.()
    const abort = () => controller.abort()
    input.signal?.addEventListener('abort', abort, { once: true })
    if (input.signal?.aborted) {
        controller.abort()
    }
    try {
        return await fetch(input.url, {
            ...input.init,
            signal: controller.signal,
        })
    } catch (error) {
        if (isAbortError(error) || controller.signal.aborted) {
            throw new SearchProviderError({
                code: 'timeout',
                providerId: input.providerId,
                retryable: true,
                message: `${input.providerId} search request timed out`,
            })
        }
        throw new SearchProviderError({
            code: 'bad_response',
            providerId: input.providerId,
            retryable: true,
            message: `${input.providerId} search request failed`,
        })
    } finally {
        input.signal?.removeEventListener('abort', abort)
        clearTimeout(timeout)
    }
}

export function assertNonEmptyResults(
    providerId: SearchProviderId,
    results: WebSearchResult[],
): void {
    if (results.length > 0) return
    throw new SearchProviderError({
        code: 'empty_results',
        providerId,
        message: `${providerId} search returned no usable results`,
    })
}

export function isPublicHttpUrl(value: string): boolean {
    try {
        const url = new URL(value)
        return url.protocol === 'http:' || url.protocol === 'https:'
    } catch {
        return false
    }
}

export async function delay(ms: number): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, ms))
}

export function formatSearchResults(results: WebSearchResult[]): string {
    return results
        .map((result) =>
            [
                `${result.rank}. ${result.title}`,
                `URL: ${result.url}`,
                `Source: ${result.engine ?? 'unknown'}`,
                `Fetched: ${result.fetchedAt}`,
                result.snippet ? `Snippet: ${result.snippet}` : null,
            ]
                .filter((line): line is string => line !== null)
                .join('\n'),
        )
        .join('\n\n')
}
