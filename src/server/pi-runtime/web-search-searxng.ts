import type { SearchErrorCode } from '../domain/types'
import type { PiRuntimeConfig } from '../rooms/pi-runtime-config'
import {
    assertNonEmptyResults,
    fetchWithTimeout,
    normalizeHtmlText,
    readResponseJsonWithTimeout,
    readResponseTextWithTimeout,
    remainingTimeoutMs,
    responseError,
    SearchProviderError,
    searchHeaders,
    type SearchProvider,
    type SearchProviderResponse,
    type SearchProviderSearchInput,
    type WebSearchResponse,
    type WebSearchResult,
} from './web-search'

interface MutableHtmlResult {
    titleParts: string[]
    url: string | null
    snippetParts: string[]
    engines: string[]
}

interface UnresponsiveSearchEngine {
    engine: string
    code: SearchErrorCode
    message: string
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

function shouldTryHtmlFallback(status: number): boolean {
    return status === 403 || status === 404 || status === 406 || status === 415
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

function formatUnresponsiveEngineReason(engines: UnresponsiveSearchEngine[]): string | null {
    const degraded = engines.filter(
        (engine) => engine.code === 'rate_limited' || engine.code === 'captcha',
    )
    if (degraded.length === 0) return null
    return degraded
        .map((engine) => `${engine.engine}: ${engine.code.replaceAll('_', ' ')}`)
        .join(', ')
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

        const jsonTimeoutMs = input.config.search.timeoutMs
        const jsonStartedAt = Date.now()
        const jsonResponse = await fetchWithTimeout({
            providerId: this.id,
            timeoutMs: jsonTimeoutMs,
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
            const parsedJson = await readResponseJsonWithTimeout({
                providerId: this.id,
                response: jsonResponse,
                timeoutMs: remainingTimeoutMs(jsonStartedAt, jsonTimeoutMs),
                signal: input.signal,
            })
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
                    reason: engine.code,
                })),
            }
        }

        const jsonError = await responseError({
            providerId: this.id,
            response: jsonResponse,
            timeoutMs: remainingTimeoutMs(jsonStartedAt, jsonTimeoutMs),
            signal: input.signal,
        })
        if (!shouldTryHtmlFallback(jsonResponse.status)) {
            throw jsonError
        }

        const htmlTimeoutMs = input.config.search.timeoutMs
        const htmlStartedAt = Date.now()
        const htmlResponse = await fetchWithTimeout({
            providerId: this.id,
            timeoutMs: htmlTimeoutMs,
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
                timeoutMs: remainingTimeoutMs(htmlStartedAt, htmlTimeoutMs),
                signal: input.signal,
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
            await readResponseTextWithTimeout({
                providerId: this.id,
                response: htmlResponse,
                timeoutMs: remainingTimeoutMs(htmlStartedAt, htmlTimeoutMs),
                signal: input.signal,
            }),
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

export async function searxngSearch(input: SearchProviderSearchInput): Promise<WebSearchResponse> {
    const response = await new SearxngSearchProvider().search(input)
    return {
        results: response.results,
        backendFormat: response.backendFormat,
        fallbackReason: response.fallbackReason,
    }
}
