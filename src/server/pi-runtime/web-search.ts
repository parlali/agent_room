import type { PiRuntimeConfig } from '../rooms/pi-runtime-config'

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
    backendFormat: 'json' | 'html'
    fallbackReason: string | null
}

const maxDomainFilters = 50

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
    return url
}

function searchHeaders(format: 'json' | 'html'): HeadersInit {
    return {
        accept: format === 'json' ? 'application/json' : 'text/html',
        'accept-language': 'en-US,en;q=0.9',
        'user-agent': 'AgentRoom/1.0',
    }
}

async function responseError(response: Response): Promise<Error> {
    const text = await response.text().catch(() => '')
    const suffix = normalizeHtmlText(text).slice(0, 160)
    return new Error(
        suffix
            ? `Search backend returned ${response.status}: ${suffix}`
            : `Search backend returned ${response.status}`,
    )
}

function shouldTryHtmlFallback(status: number): boolean {
    return status === 403 || status === 404 || status === 406 || status === 415
}

export async function searxngSearch(input: {
    config: PiRuntimeConfig
    query: string
    count: number
    language?: string | null
    freshness?: string | null
    safeSearch?: string | null
    location?: string | null
    signal?: AbortSignal
}): Promise<WebSearchResponse> {
    if (!input.config.search.enabled || !input.config.search.backendUrl) {
        throw new Error('Web search is not configured')
    }
    const query = input.query.trim()
    if (!query) {
        throw new Error('Search query cannot be empty')
    }
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), input.config.search.timeoutMs)
    timeout.unref?.()
    input.signal?.addEventListener('abort', () => controller.abort(), { once: true })

    try {
        const jsonResponse = await fetch(
            buildSearxngSearchUrl({
                config: input.config,
                query,
                language: input.language,
                freshness: input.freshness,
                safeSearch: input.safeSearch,
                location: input.location,
                format: 'json',
            }),
            {
                headers: searchHeaders('json'),
                signal: controller.signal,
            },
        )
        if (jsonResponse.ok) {
            const parsed = parseSearxngResults(await jsonResponse.json(), new Date().toISOString())
            return {
                results: parsed.slice(0, input.count),
                backendFormat: 'json',
                fallbackReason: null,
            }
        }

        const jsonError = await responseError(jsonResponse)
        if (!shouldTryHtmlFallback(jsonResponse.status)) {
            throw jsonError
        }
        const htmlResponse = await fetch(
            buildSearxngSearchUrl({
                config: input.config,
                query,
                language: input.language,
                freshness: input.freshness,
                safeSearch: input.safeSearch,
                location: input.location,
            }),
            {
                headers: searchHeaders('html'),
                signal: controller.signal,
            },
        )
        if (!htmlResponse.ok) {
            const htmlError = await responseError(htmlResponse)
            throw new Error(`${jsonError.message}; HTML fallback failed: ${htmlError.message}`)
        }
        const parsed = await parseSearxngHtmlResults(
            await htmlResponse.text(),
            new Date().toISOString(),
        )
        return {
            results: parsed.slice(0, input.count),
            backendFormat: 'html',
            fallbackReason: jsonError.message,
        }
    } finally {
        clearTimeout(timeout)
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
