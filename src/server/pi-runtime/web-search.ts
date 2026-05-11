import type { PiRuntimeConfig } from '../rooms/pi-runtime-config'

export interface WebSearchResult {
    title: string
    url: string
    snippet: string
    engine: string | null
    fetchedAt: string
    rank: number
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

export async function searxngSearch(input: {
    config: PiRuntimeConfig
    query: string
    count: number
    language?: string | null
    freshness?: string | null
    safeSearch?: string | null
    location?: string | null
    signal?: AbortSignal
}): Promise<WebSearchResult[]> {
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

    const url = new URL('/search', input.config.search.backendUrl)
    url.searchParams.set('q', query)
    url.searchParams.set('format', 'json')
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

    try {
        const response = await fetch(url, {
            headers: {
                accept: 'application/json',
            },
            signal: controller.signal,
        })
        if (!response.ok) {
            throw new Error(`Search backend returned ${response.status}`)
        }
        const parsed = parseSearxngResults(await response.json(), new Date().toISOString())
        return parsed.slice(0, input.count)
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
