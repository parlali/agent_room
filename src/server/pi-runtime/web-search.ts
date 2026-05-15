import type { SearchErrorCode, SearchProviderId } from '../domain/types'
import type { PiRuntimeConfig } from '../rooms/pi-runtime-config'
import { currentToolRunContext } from './tool-run-context'

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

type SearchAudit = (event: string, payload: unknown) => Promise<void>

const maxDomainFilters = 50
const healthBackoffMs = 60_000
const maxInflightEntries = 200
const browserbaseApiBaseUrl = 'https://api.browserbase.com/v1'
const braveSearchApiUrl = 'https://api.search.brave.com/res/v1/web/search'
const browserSearchUrl = 'https://search.brave.com/search'

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

function parseEngines(value: unknown): string | null {
    if (typeof value === 'string' && value.trim()) {
        return value.trim()
    }
    if (Array.isArray(value)) {
        const engines = value
            .filter(
                (entry): entry is string => typeof entry === 'string' && entry.trim().length > 0,
            )
            .map((entry) => entry.trim())
        return engines.length > 0 ? engines.join(', ') : null
    }
    return null
}

export function normalizeSearxngSafeSearch(value: string | null | undefined): string | null {
    const normalized = value?.trim().toLowerCase()
    if (!normalized) {
        return null
    }
    if (['0', 'off', 'none', 'false'].includes(normalized)) {
        return '0'
    }
    if (['1', 'moderate', 'medium', 'true'].includes(normalized)) {
        return '1'
    }
    if (['2', 'strict', 'high'].includes(normalized)) {
        return '2'
    }
    throw new Error('safeSearch must be off, moderate, strict, 0, 1, or 2')
}

function normalizeBraveSafeSearch(value: string | null | undefined): 'off' | 'moderate' | 'strict' {
    const normalized = value?.trim().toLowerCase()
    if (!normalized) {
        return 'moderate'
    }
    if (['0', 'off', 'none', 'false'].includes(normalized)) {
        return 'off'
    }
    if (['1', 'moderate', 'medium', 'true'].includes(normalized)) {
        return 'moderate'
    }
    if (['2', 'strict', 'high'].includes(normalized)) {
        return 'strict'
    }
    throw new Error('safeSearch must be off, moderate, strict, 0, 1, or 2')
}

export function parseSearxngResults(value: unknown, fetchedAt: string): WebSearchResult[] {
    if (
        !value ||
        typeof value !== 'object' ||
        !Array.isArray((value as { results?: unknown }).results)
    ) {
        return []
    }

    return (value as { results: unknown[] }).results
        .map((entry, index): WebSearchResult | null => {
            if (!entry || typeof entry !== 'object') {
                return null
            }
            const record = entry as Record<string, unknown>
            const url = typeof record.url === 'string' ? record.url.trim() : ''
            const title = typeof record.title === 'string' ? record.title.trim() : ''
            if (!url || !title) {
                return null
            }
            try {
                const parsed = new URL(url)
                if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
                    return null
                }
            } catch {
                return null
            }
            return {
                title,
                url,
                snippet:
                    typeof record.content === 'string'
                        ? record.content.trim()
                        : typeof record.snippet === 'string'
                          ? record.snippet.trim()
                          : '',
                engine: parseEngines(record.engine ?? record.engines),
                fetchedAt,
                rank: index + 1,
            }
        })
        .filter((entry): entry is WebSearchResult => entry !== null)
}

interface MutableHtmlResult {
    titleParts: string[]
    url: string | null
    snippetParts: string[]
    engines: string[]
}

function normalizeHtmlText(value: string): string {
    return value.replace(/\s+/g, ' ').trim()
}

function toWebSearchResult(
    result: MutableHtmlResult,
    fetchedAt: string,
    index: number,
): WebSearchResult | null {
    const title = normalizeHtmlText(result.titleParts.join(''))
    const url = result.url?.trim() ?? ''
    if (!title || !url) {
        return null
    }
    try {
        const parsed = new URL(url)
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
            return null
        }
    } catch {
        return null
    }
    return {
        title,
        url,
        snippet: normalizeHtmlText(result.snippetParts.join('')),
        engine: result.engines.length > 0 ? result.engines.join(', ') : null,
        fetchedAt,
        rank: index + 1,
    }
}

export async function parseSearxngHtmlResults(
    html: string,
    fetchedAt: string,
): Promise<WebSearchResult[]> {
    return extractHtmlArticles(html)
        .map(parseSearxngArticle)
        .map((result, index) => toWebSearchResult(result, fetchedAt, index))
        .filter((entry): entry is WebSearchResult => entry !== null)
}

function extractHtmlArticles(html: string): string[] {
    return [
        ...html.matchAll(
            /<article\b[^>]*class=["'][^"']*\bresult\b[^"']*["'][^>]*>[\s\S]*?<\/article>/gi,
        ),
    ].map((match) => match[0])
}

function parseSearxngArticle(article: string): MutableHtmlResult {
    const titleMatch = article.match(/<h3\b[\s\S]*?<a\b([^>]*)>([\s\S]*?)<\/a>[\s\S]*?<\/h3>/i)
    const contentMatch = article.match(
        /<p\b[^>]*class=["'][^"']*\bcontent\b[^"']*["'][^>]*>([\s\S]*?)<\/p>/i,
    )
    const enginesMatch = article.match(
        /<div\b[^>]*class=["'][^"']*\bengines\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/i,
    )
    return {
        titleParts: [titleMatch ? stripHtml(titleMatch[2]) : ''],
        url: titleMatch ? decodeHtmlEntities(attributeValue(titleMatch[1], 'href') ?? '') : null,
        snippetParts: [contentMatch ? stripHtml(contentMatch[1]) : ''],
        engines: enginesMatch ? extractSpanText(enginesMatch[1]) : [],
    }
}

function attributeValue(attributes: string, name: string): string | null {
    const match = attributes.match(
        new RegExp(`${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'),
    )
    return match?.[1] ?? match?.[2] ?? match?.[3] ?? null
}

function stripHtml(value: string): string {
    return normalizeHtmlText(decodeHtmlEntities(value.replace(/<[^>]+>/g, '')))
}

function extractSpanText(value: string): string[] {
    return [...value.matchAll(/<span\b[^>]*>([\s\S]*?)<\/span>/gi)]
        .map((match) => stripHtml(match[1]))
        .filter((entry) => entry.length > 0)
}

function decodeHtmlEntities(value: string): string {
    const named: Record<string, string> = {
        amp: '&',
        gt: '>',
        lt: '<',
        quot: '"',
        apos: "'",
        nbsp: ' ',
    }
    return value.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (_match, entity: string) => {
        const normalized = entity.toLowerCase()
        if (normalized.startsWith('#x')) {
            return String.fromCodePoint(Number.parseInt(normalized.slice(2), 16))
        }
        if (normalized.startsWith('#')) {
            return String.fromCodePoint(Number.parseInt(normalized.slice(1), 10))
        }
        return named[normalized] ?? _match
    })
}

function buildSearxngSearchUrl(input: {
    config: PiRuntimeConfig
    query: string
    language?: string | null
    freshness?: string | null
    safeSearch?: string | null
    location?: string | null
    disabledEngines?: string[]
    format?: 'json'
}): URL {
    const url = new URL('/search', input.config.search.backendUrl)
    url.searchParams.set('q', input.query)
    if (input.format) {
        url.searchParams.set('format', input.format)
    }
    url.searchParams.set('categories', 'general')
    url.searchParams.set('pageno', '1')
    if (input.language?.trim()) {
        url.searchParams.set('language', input.language.trim())
    }
    if (input.freshness?.trim()) {
        url.searchParams.set('time_range', input.freshness.trim())
    }
    const safeSearch = normalizeSearxngSafeSearch(input.safeSearch)
    if (safeSearch) {
        url.searchParams.set('safesearch', safeSearch)
    }
    if (input.location?.trim()) {
        url.searchParams.set('locale', input.location.trim())
    }
    if (input.disabledEngines && input.disabledEngines.length > 0) {
        url.searchParams.set('disabled_engines', input.disabledEngines.join(','))
    }
    return url
}

function buildBraveSearchUrl(input: SearchProviderSearchInput): URL {
    const config = input.config.search.brave
    const url = new URL(braveSearchApiUrl)
    url.searchParams.set('q', input.query.trim())
    url.searchParams.set('count', String(Math.min(20, input.count || config.resultCount)))
    url.searchParams.set(
        'safesearch',
        normalizeBraveSafeSearch(input.safeSearch ?? config.safeSearch),
    )
    if (input.freshness?.trim()) {
        url.searchParams.set('freshness', input.freshness.trim())
    }
    if (input.location?.trim()) {
        url.searchParams.set('country', input.location.trim().slice(0, 2).toUpperCase())
    } else if (config.country) {
        url.searchParams.set('country', config.country.slice(0, 2).toUpperCase())
    }
    if (input.language?.trim()) {
        url.searchParams.set('search_lang', input.language.trim().slice(0, 5))
    } else if (config.searchLang) {
        url.searchParams.set('search_lang', config.searchLang)
    }
    return url
}

function searchHeaders(format: 'json' | 'html'): HeadersInit {
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

async function responseError(input: {
    providerId: SearchProviderId
    response: Response
}): Promise<SearchProviderError> {
    const text = await responseText(input.response)
    const suffix = boundedResponseText(text)
    return classifySearchHttpError({
        providerId: input.providerId,
        status: input.response.status,
        text: suffix,
    })
}

function classifySearchHttpError(input: {
    providerId: SearchProviderId
    status: number
    text: string
}): SearchProviderError {
    const lower = input.text.toLowerCase()
    if (input.status === 429) {
        return new SearchProviderError({
            code: 'rate_limited',
            providerId: input.providerId,
            retryable: false,
            status: input.status,
            message: searchErrorMessage(input.providerId, 'rate_limited', input.status, input.text),
        })
    }
    if (input.status === 408 || input.status === 504) {
        return new SearchProviderError({
            code: 'timeout',
            providerId: input.providerId,
            retryable: true,
            status: input.status,
            message: searchErrorMessage(input.providerId, 'timeout', input.status, input.text),
        })
    }
    if (lower.includes('captcha')) {
        return new SearchProviderError({
            code: 'captcha',
            providerId: input.providerId,
            retryable: false,
            status: input.status,
            message: searchErrorMessage(input.providerId, 'captcha', input.status, input.text),
        })
    }
    if (
        input.status === 401 ||
        lower.includes('invalid api key') ||
        lower.includes('unauthorized') ||
        lower.includes('not enabled')
    ) {
        return new SearchProviderError({
            code: 'misconfigured',
            providerId: input.providerId,
            retryable: false,
            status: input.status,
            message: searchErrorMessage(
                input.providerId,
                'misconfigured',
                input.status,
                input.text,
            ),
        })
    }
    if (
        input.status === 402 ||
        input.status === 403 ||
        lower.includes('quota') ||
        lower.includes('billing') ||
        lower.includes('blocked') ||
        lower.includes('forbidden')
    ) {
        return new SearchProviderError({
            code: 'blocked',
            providerId: input.providerId,
            retryable: false,
            status: input.status,
            message: searchErrorMessage(input.providerId, 'blocked', input.status, input.text),
        })
    }
    return new SearchProviderError({
        code: 'bad_response',
        providerId: input.providerId,
        retryable: input.status >= 500,
        status: input.status,
        message: searchErrorMessage(input.providerId, 'bad_response', input.status, input.text),
    })
}

function searchErrorMessage(
    providerId: SearchProviderId,
    code: SearchErrorCode,
    status: number | null,
    text: string,
): string {
    const statusText = status ? ` returned ${status}` : ' failed'
    const suffix = text ? `: ${text}` : ''
    return `${providerId} search ${code.replaceAll('_', ' ')}${statusText}${suffix}`
}

function shouldTryHtmlFallback(status: number): boolean {
    return status === 403 || status === 404 || status === 406 || status === 415
}

function isAbortError(error: unknown): boolean {
    return error instanceof DOMException ||
        error instanceof Error ||
        (typeof error === 'object' && error !== null)
        ? String((error as { name?: unknown }).name ?? '').toLowerCase() === 'aborterror'
        : false
}

async function fetchWithTimeout(input: {
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
                message: `${input.providerId} search timed out`,
            })
        }
        throw new SearchProviderError({
            code: 'bad_response',
            providerId: input.providerId,
            retryable: true,
            message: error instanceof Error ? error.message : `${input.providerId} search failed`,
        })
    } finally {
        input.signal?.removeEventListener('abort', abort)
        clearTimeout(timeout)
    }
}

interface UnresponsiveSearchEngine {
    engine: string
    code: SearchErrorCode
    message: string
}

function parseSearxngUnresponsiveEngines(value: unknown): UnresponsiveSearchEngine[] {
    if (!value || typeof value !== 'object') return []
    const entries = (value as { unresponsive_engines?: unknown }).unresponsive_engines
    if (!Array.isArray(entries)) return []
    return entries
        .map((entry): UnresponsiveSearchEngine | null => {
            if (!Array.isArray(entry) || entry.length === 0) return null
            const engine = typeof entry[0] === 'string' ? entry[0].trim() : ''
            const message = entry
                .slice(1)
                .filter((item): item is string => typeof item === 'string')
                .join(' ')
            if (!engine) return null
            return {
                engine,
                code: classifySearchEngineMessage(message),
                message,
            }
        })
        .filter((entry): entry is UnresponsiveSearchEngine => entry !== null)
}

function classifySearchEngineMessage(message: string): SearchErrorCode {
    const normalized = message.toLowerCase()
    if (normalized.includes('rate') || normalized.includes('too many')) return 'rate_limited'
    if (normalized.includes('captcha')) return 'captcha'
    if (normalized.includes('timeout')) return 'timeout'
    if (normalized.includes('blocked') || normalized.includes('forbidden')) return 'blocked'
    return 'bad_response'
}

export class SearxngSearchProvider implements SearchProvider {
    id = 'searxng' as const
    label = 'SearXNG'
    priority = 30

    isConfigured(config: PiRuntimeConfig): boolean {
        return config.search.enabled && Boolean(config.search.backendUrl)
    }

    async search(input: SearchProviderSearchInput): Promise<SearchProviderResponse> {
        if (!this.isConfigured(input.config)) {
            throw new SearchProviderError({
                code: 'misconfigured',
                providerId: this.id,
                message: 'SearXNG search is not configured',
            })
        }
        const query = input.query.trim()
        if (!query) {
            throw new SearchProviderError({
                code: 'misconfigured',
                providerId: this.id,
                message: 'Search query cannot be empty',
            })
        }

        const jsonResponse = await fetchWithTimeout({
            providerId: this.id,
            timeoutMs: input.config.search.timeoutMs,
            signal: input.signal,
            url: buildSearxngSearchUrl({
                config: input.config,
                query,
                language: input.language,
                freshness: input.freshness,
                safeSearch: input.safeSearch,
                location: input.location,
                disabledEngines: input.disabledEngines,
                format: 'json',
            }),
            init: {
                headers: searchHeaders('json'),
            },
        })
        if (jsonResponse.ok) {
            const fetchedAt = new Date().toISOString()
            const parsedJson: unknown = await jsonResponse.json()
            const results = parseSearxngResults(parsedJson, fetchedAt).slice(0, input.count)
            const unresponsiveEngines = parseSearxngUnresponsiveEngines(parsedJson)
            assertNonEmptyResults(this.id, results)
            return {
                results,
                backendFormat: 'json',
                fallbackReason: null,
                degradedReason: formatUnresponsiveEngineReason(unresponsiveEngines),
                browserMediated: false,
                engineFailures: unresponsiveEngines.map((engine) => ({
                    engine: engine.engine,
                    code: engine.code,
                    reason: engine.message || engine.code,
                })),
            }
        }

        const jsonError = await responseError({
            providerId: this.id,
            response: jsonResponse,
        })
        if (!shouldTryHtmlFallback(jsonResponse.status)) {
            throw jsonError
        }

        const htmlResponse = await fetchWithTimeout({
            providerId: this.id,
            timeoutMs: input.config.search.timeoutMs,
            signal: input.signal,
            url: buildSearxngSearchUrl({
                config: input.config,
                query,
                language: input.language,
                freshness: input.freshness,
                safeSearch: input.safeSearch,
                location: input.location,
                disabledEngines: input.disabledEngines,
            }),
            init: {
                headers: searchHeaders('html'),
            },
        })
        if (!htmlResponse.ok) {
            const htmlError = await responseError({
                providerId: this.id,
                response: htmlResponse,
            })
            throw new SearchProviderError({
                code: htmlError.code,
                providerId: this.id,
                retryable: htmlError.retryable,
                status: htmlError.status,
                message: `${jsonError.message}; HTML fallback failed: ${htmlError.message}`,
            })
        }
        const parsed = await parseSearxngHtmlResults(
            await htmlResponse.text(),
            new Date().toISOString(),
        )
        const results = parsed.slice(0, input.count)
        assertNonEmptyResults(this.id, results)
        return {
            results,
            backendFormat: 'html',
            fallbackReason: jsonError.message,
            degradedReason: jsonError.message,
            browserMediated: false,
            engineFailures: [],
        }
    }
}

export class BraveSearchProvider implements SearchProvider {
    id = 'brave' as const
    label = 'Brave Search'
    priority = 10

    isConfigured(config: PiRuntimeConfig): boolean {
        const envKey = config.search.brave.envKey
        return config.search.brave.enabled && Boolean(envKey && process.env[envKey])
    }

    async search(input: SearchProviderSearchInput): Promise<SearchProviderResponse> {
        const envKey = input.config.search.brave.envKey
        const apiKey = envKey ? process.env[envKey] : null
        if (!apiKey) {
            throw new SearchProviderError({
                code: 'misconfigured',
                providerId: this.id,
                message: 'Brave Search API key is not materialized',
            })
        }

        const response = await fetchWithTimeout({
            providerId: this.id,
            timeoutMs: input.config.search.brave.timeoutMs,
            signal: input.signal,
            url: buildBraveSearchUrl(input),
            init: {
                headers: {
                    accept: 'application/json',
                    'accept-language': 'en-US,en;q=0.9',
                    'user-agent': 'AgentRoom/1.0',
                    'x-subscription-token': apiKey,
                },
            },
        })
        if (!response.ok) {
            throw await responseError({
                providerId: this.id,
                response,
            })
        }

        const results = parseBraveSearchResults(
            await response.json(),
            new Date().toISOString(),
        ).slice(0, input.count)
        assertNonEmptyResults(this.id, results)
        return {
            results,
            backendFormat: 'api',
            fallbackReason: null,
            degradedReason: null,
            browserMediated: false,
        }
    }
}

export function parseBraveSearchResults(value: unknown, fetchedAt: string): WebSearchResult[] {
    const results =
        value && typeof value === 'object' && !Array.isArray(value)
            ? (value as { web?: { results?: unknown } }).web?.results
            : null
    if (!Array.isArray(results)) return []
    return results
        .map((entry, index): WebSearchResult | null => {
            if (!entry || typeof entry !== 'object') return null
            const record = entry as Record<string, unknown>
            const title = typeof record.title === 'string' ? normalizeHtmlText(record.title) : ''
            const url = typeof record.url === 'string' ? record.url.trim() : ''
            if (!title || !isPublicHttpUrl(url)) return null
            const snippets = [
                typeof record.description === 'string' ? record.description : '',
                ...(Array.isArray(record.extra_snippets)
                    ? record.extra_snippets.filter(
                          (snippet): snippet is string => typeof snippet === 'string',
                      )
                    : []),
            ].filter((snippet) => snippet.trim().length > 0)
            return {
                title,
                url,
                snippet: normalizeHtmlText(snippets.join(' ')),
                engine: 'brave',
                fetchedAt,
                rank: index + 1,
            }
        })
        .filter((entry): entry is WebSearchResult => entry !== null)
}

interface BrowserbaseSessionRecord {
    id: string
    connectUrl: string
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

        const session = await createBrowserbaseSession({
            apiKey,
            projectId,
            timeoutMs: input.config.search.browserbase.timeoutMs,
            signal: input.signal,
        })
        try {
            const extracted = await runBrowserMediatedSearch({
                connectUrl: session.connectUrl,
                query: input.query,
                count: input.count,
                timeoutMs: input.config.search.browserbase.timeoutMs,
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
}): Promise<void> {
    await fetch(`${browserbaseApiBaseUrl}/sessions/${encodeURIComponent(input.sessionId)}`, {
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
    })
}

interface BrowserExtractedResult {
    title: string
    url: string
    snippet: string
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

class CdpClient {
    private ws: WebSocket
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
    }> = []

    private constructor(ws: WebSocket) {
        this.ws = ws
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
            const timeout = setTimeout(() => {
                if (settled) return
                settled = true
                ws.close()
                reject(
                    new SearchProviderError({
                        code: 'timeout',
                        providerId: 'browserbase',
                        retryable: true,
                        message: 'Browserbase CDP connection timed out',
                    }),
                )
            }, timeoutMs)
            timeout.unref?.()
            const abort = () => {
                if (settled) return
                settled = true
                clearTimeout(timeout)
                ws.close()
                reject(
                    new SearchProviderError({
                        code: 'timeout',
                        providerId: 'browserbase',
                        retryable: true,
                        message: 'Browserbase CDP connection aborted',
                    }),
                )
            }
            signal?.addEventListener('abort', abort, { once: true })
            ws.addEventListener('open', () => {
                if (settled) return
                settled = true
                clearTimeout(timeout)
                signal?.removeEventListener('abort', abort)
                resolve(new CdpClient(ws))
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

    send<T>(method: string, params: Record<string, unknown> = {}, sessionId?: string): Promise<T> {
        const id = this.nextId
        this.nextId += 1
        const payload = JSON.stringify({
            id,
            method,
            params,
            ...(sessionId ? { sessionId } : {}),
        })
        return new Promise((resolve, reject) => {
            this.pending.set(id, {
                resolve: (value) => resolve(value as T),
                reject,
            })
            this.ws.send(payload)
        })
    }

    waitForEvent(method: string, sessionId: string | null, timeoutMs: number): Promise<unknown> {
        return new Promise((resolve, reject) => {
            const waiter = {
                method,
                sessionId,
                resolve,
            }
            this.eventWaiters.push(waiter)
            const timeout = setTimeout(() => {
                this.eventWaiters = this.eventWaiters.filter((entry) => entry !== waiter)
                reject(
                    new SearchProviderError({
                        code: 'timeout',
                        providerId: 'browserbase',
                        retryable: true,
                        message: `Timed out waiting for ${method}`,
                    }),
                )
            }, timeoutMs)
            timeout.unref?.()
            waiter.resolve = (value: unknown) => {
                clearTimeout(timeout)
                resolve(value)
            }
        })
    }

    async close(): Promise<void> {
        if (this.ws.readyState === WebSocket.OPEN) {
            await this.send('Browser.close').catch(() => undefined)
        }
        this.ws.close()
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
            this.pending.delete(parsed.id)
            if (parsed.error) {
                pending.reject(new Error(parsed.error.message ?? 'CDP command failed'))
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
                this.eventWaiters = this.eventWaiters.filter((entry) => entry !== waiter)
                waiter.resolve(parsed.params ?? {})
            }
        }
    }

    private rejectPending(message: string): void {
        const pending = [...this.pending.values()]
        this.pending.clear()
        for (const entry of pending) {
            entry.reject(new Error(message))
        }
    }
}

function assertNonEmptyResults(providerId: SearchProviderId, results: WebSearchResult[]): void {
    if (results.length > 0) return
    throw new SearchProviderError({
        code: 'empty_results',
        providerId,
        message: `${providerId} search returned no usable results`,
    })
}

function formatUnresponsiveEngineReason(engines: UnresponsiveSearchEngine[]): string | null {
    const degraded = engines.filter(
        (engine) => engine.code === 'rate_limited' || engine.code === 'captcha',
    )
    if (degraded.length === 0) return null
    return degraded
        .map((engine) => `${engine.engine}: ${engine.code.replaceAll('_', ' ')}`)
        .join(', ')
}

function isPublicHttpUrl(value: string): boolean {
    try {
        const url = new URL(value)
        return url.protocol === 'http:' || url.protocol === 'https:'
    } catch {
        return false
    }
}

interface SearchHealthEntry {
    backoffUntil: number
    code: SearchErrorCode
    reason: string
}

export class SearchRouter {
    private providers: SearchProvider[]
    private health = new Map<string, SearchHealthEntry>()
    private inFlight = new Map<string, Promise<RoutedWebSearchResponse>>()
    private runBudgets = new Map<string, { count: number; updatedAt: number }>()

    constructor(providers: SearchProvider[] = defaultSearchProviders()) {
        this.providers = [...providers].sort((left, right) => left.priority - right.priority)
    }

    async search(
        input: SearchProviderSearchInput & {
            audit?: SearchAudit
        },
    ): Promise<RoutedWebSearchResponse> {
        const runKey = searchRunKey(input.config)
        this.pruneState()
        const dedupeKey = searchDedupeKey(runKey, input)
        const existing = this.inFlight.get(dedupeKey)
        if (existing) {
            return existing
        }
        this.consumeBudget(input.config, runKey)
        const promise = this.routeSearch(input)
        this.inFlight.set(dedupeKey, promise)
        try {
            return await promise
        } finally {
            this.inFlight.delete(dedupeKey)
        }
    }

    private consumeBudget(config: PiRuntimeConfig, runKey: string): void {
        const current = this.runBudgets.get(runKey) ?? { count: 0, updatedAt: Date.now() }
        if (current.count >= config.search.maxSearchesPerRun) {
            throw new SearchProviderError({
                code: 'budget_exceeded',
                providerId: null,
                message: `Web search budget exhausted for this run. The agent should synthesize from gathered evidence or ask for a narrower scope before searching again.`,
            })
        }
        this.runBudgets.set(runKey, {
            count: current.count + 1,
            updatedAt: Date.now(),
        })
    }

    private async routeSearch(
        input: SearchProviderSearchInput & {
            audit?: SearchAudit
        },
    ): Promise<RoutedWebSearchResponse> {
        const chain: SearchFallbackStep[] = []
        const providers = this.providers.filter((provider) => provider.isConfigured(input.config))
        let lastError: SearchProviderError | null = null
        if (providers.length === 0) {
            throw new SearchProviderError({
                code: 'misconfigured',
                providerId: null,
                message: 'No configured search provider is available',
            })
        }

        for (const provider of providers) {
            const health = this.providerHealth(provider.id)
            if (health) {
                chain.push({
                    backend: provider.id,
                    backendLabel: provider.label,
                    status: 'skipped',
                    attempts: 0,
                    errorCode: health.code,
                    reason: health.reason,
                })
                continue
            }
            const selectedStep: SearchFallbackStep = {
                backend: provider.id,
                backendLabel: provider.label,
                status: 'selected',
                attempts: 0,
                errorCode: null,
                reason: null,
            }
            chain.push(selectedStep)
            await input.audit?.('search.provider_selected', {
                backend: provider.id,
                backendLabel: provider.label,
                query: input.query,
            })
            const maxAttempts = 2
            for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
                selectedStep.attempts = attempt
                try {
                    const response = await provider.search({
                        ...input,
                        disabledEngines: this.engineBackoffEngines(provider.id),
                    })
                    this.recordEngineHealth(provider.id, response.engineFailures ?? [])
                    selectedStep.status = 'complete'
                    const priorFailures = chain.filter(
                        (step) => step.status === 'failed' || step.status === 'skipped',
                    )
                    const degradedReason =
                        response.degradedReason ??
                        (priorFailures.length > 0
                            ? `Fallback after ${priorFailures
                                  .map((step) => `${step.backend}: ${step.reason ?? step.status}`)
                                  .join('; ')}`
                            : null)
                    await input.audit?.('search.provider_completed', {
                        backend: provider.id,
                        backendLabel: provider.label,
                        resultCount: response.results.length,
                        degraded: degradedReason !== null,
                        degradedReason,
                    })
                    return {
                        ...response,
                        backend: provider.id,
                        backendLabel: provider.label,
                        fallbackChain: chain,
                        degraded: degradedReason !== null,
                        degradedReason,
                        resultCount: response.results.length,
                    }
                } catch (error) {
                    const searchError = asSearchProviderError(error, provider.id)
                    lastError = searchError
                    selectedStep.status = 'failed'
                    selectedStep.errorCode = searchError.code
                    selectedStep.reason = searchError.message
                    this.recordHealth(provider.id, searchError)
                    if (attempt < maxAttempts && shouldRetry(searchError)) {
                        selectedStep.status = 'retrying'
                        await input.audit?.('search.provider_retrying', {
                            backend: provider.id,
                            backendLabel: provider.label,
                            attempt,
                            errorCode: searchError.code,
                            error: searchError.message,
                        })
                        await delay(200)
                        continue
                    }
                    await input.audit?.('search.provider_failed', {
                        backend: provider.id,
                        backendLabel: provider.label,
                        attempts: attempt,
                        errorCode: searchError.code,
                        error: searchError.message,
                    })
                    break
                }
            }
        }

        const error = new SearchProviderError({
            code: lastError?.code ?? 'bad_response',
            providerId: lastError?.providerId ?? null,
            retryable: lastError?.retryable ?? false,
            status: lastError?.status ?? null,
            message: `All configured search providers failed: ${chain
                .map((step) => `${step.backend}: ${step.reason ?? step.status}`)
                .join('; ')}`,
        })
        await input.audit?.('search.final_failure', {
            error: error.message,
            fallbackChain: chain,
        })
        throw error
    }

    private providerHealth(providerId: SearchProviderId): SearchHealthEntry | null {
        const entry = this.health.get(backendHealthKey(providerId))
        if (!entry) return null
        if (entry.backoffUntil <= Date.now()) {
            this.health.delete(backendHealthKey(providerId))
            return null
        }
        return entry
    }

    private recordHealth(providerId: SearchProviderId, error: SearchProviderError): void {
        if (error.code !== 'rate_limited' && error.code !== 'captcha') return
        this.health.set(backendHealthKey(providerId), {
            backoffUntil: Date.now() + healthBackoffMs,
            code: error.code,
            reason: error.message,
        })
    }

    private recordEngineHealth(
        providerId: SearchProviderId,
        failures: SearchEngineFailure[],
    ): void {
        for (const failure of failures) {
            if (failure.code !== 'rate_limited' && failure.code !== 'captcha') continue
            this.health.set(engineHealthKey(providerId, failure.engine), {
                backoffUntil: Date.now() + healthBackoffMs,
                code: failure.code,
                reason: failure.reason,
            })
        }
    }

    private engineBackoffEngines(providerId: SearchProviderId): string[] {
        const prefix = `${backendHealthKey(providerId)}:engine:`
        const engines: string[] = []
        for (const [key, value] of this.health) {
            if (value.backoffUntil <= Date.now()) continue
            if (key.startsWith(prefix)) {
                engines.push(key.slice(prefix.length))
            }
        }
        return engines
    }

    private pruneState(): void {
        const now = Date.now()
        for (const [key, entry] of this.health) {
            if (entry.backoffUntil <= now) {
                this.health.delete(key)
            }
        }
        for (const [key, entry] of this.runBudgets) {
            if (now - entry.updatedAt > 2 * 60 * 60 * 1000) {
                this.runBudgets.delete(key)
            }
        }
        if (this.inFlight.size <= maxInflightEntries) return
        for (const key of this.inFlight.keys()) {
            this.inFlight.delete(key)
            if (this.inFlight.size <= maxInflightEntries) break
        }
    }
}

function defaultSearchProviders(): SearchProvider[] {
    return [new BraveSearchProvider(), new BrowserbaseSearchProvider(), new SearxngSearchProvider()]
}

function backendHealthKey(providerId: SearchProviderId): string {
    return `backend:${providerId}`
}

function engineHealthKey(providerId: SearchProviderId, engine: string): string {
    return `${backendHealthKey(providerId)}:engine:${engine}`
}

function asSearchProviderError(error: unknown, providerId: SearchProviderId): SearchProviderError {
    if (error instanceof SearchProviderError) return error
    return new SearchProviderError({
        code: 'bad_response',
        providerId,
        retryable: true,
        message: error instanceof Error ? error.message : `${providerId} search failed`,
    })
}

function shouldRetry(error: SearchProviderError): boolean {
    return error.retryable && (error.code === 'timeout' || error.code === 'bad_response')
}

function searchRunKey(config: PiRuntimeConfig): string {
    const context = currentToolRunContext()
    if (!context) return `${config.runtime.roomId}:adhoc`
    return `${config.runtime.roomId}:${context.sessionKey}:${context.runId}`
}

function searchDedupeKey(runKey: string, input: SearchProviderSearchInput): string {
    return JSON.stringify({
        runKey,
        query: input.query.trim().toLowerCase(),
        count: input.count,
        language: input.language?.trim() ?? null,
        freshness: input.freshness?.trim() ?? null,
        safeSearch: input.safeSearch?.trim() ?? null,
        location: input.location?.trim() ?? null,
    })
}

async function delay(ms: number): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, ms))
}

export async function searxngSearch(input: SearchProviderSearchInput): Promise<WebSearchResponse> {
    const response = await new SearxngSearchProvider().search(input)
    return {
        results: response.results,
        backendFormat: response.backendFormat,
        fallbackReason: response.fallbackReason,
    }
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
