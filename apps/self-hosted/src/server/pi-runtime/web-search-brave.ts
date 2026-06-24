import {
    assertNonEmptyResults,
    fetchWithTimeout,
    normalizeHtmlText,
    publicHttpSearchResultFromUnknown,
    readResponseJsonWithTimeout,
    remainingTimeoutMs,
    responseError,
    SearchProviderError,
    type SearchProvider,
    type SearchProviderResponse,
    type SearchProviderSearchInput,
    type SearchRuntimeConfigScope,
    type WebSearchResult,
} from './web-search'
import {
    hostedRuntimeBraveProxyUrlEnvKey,
    piRuntimeTokenEnvKey,
} from '../rooms/pi-runtime-contract'
import { timingSafeEqualString } from '../security/timing-safe'

const braveSearchApiUrl = 'https://api.search.brave.com/res/v1/web/search'

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

function buildBraveSearchUrl(input: SearchProviderSearchInput): URL {
    const config = input.config.search.brave
    const url = new URL(process.env[hostedRuntimeBraveProxyUrlEnvKey] ?? braveSearchApiUrl)
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

function isHostedRuntimeToken(value: string): boolean {
    const runtimeToken = process.env[piRuntimeTokenEnvKey]?.trim()
    return Boolean(runtimeToken && timingSafeEqualString(value, runtimeToken))
}

function braveSearchHeaders(apiKey: string): Record<string, string> {
    const headers = {
        accept: 'application/json',
        'accept-language': 'en-US,en;q=0.9',
        'user-agent': 'AgentRoom/1.0',
    }
    return process.env[hostedRuntimeBraveProxyUrlEnvKey]?.trim()
        ? {
              ...headers,
              authorization: `Bearer ${apiKey}`,
          }
        : {
              ...headers,
              'x-subscription-token': apiKey,
          }
}

export class BraveSearchProvider implements SearchProvider {
    id = 'brave' as const
    label = 'Brave Search'
    priority = 10

    isConfigured(config: SearchRuntimeConfigScope): boolean {
        const envKey = config.search.brave.envKey
        return (
            config.search.enabled &&
            config.search.brave.enabled &&
            Boolean(envKey && process.env[envKey])
        )
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
        if (
            !process.env[hostedRuntimeBraveProxyUrlEnvKey]?.trim() &&
            isHostedRuntimeToken(apiKey)
        ) {
            throw new SearchProviderError({
                code: 'misconfigured',
                providerId: this.id,
                message: 'Hosted Brave proxy URL is not materialized',
            })
        }

        const timeoutMs = input.config.search.brave.timeoutMs
        const startedAt = Date.now()
        const response = await fetchWithTimeout({
            providerId: this.id,
            timeoutMs,
            signal: input.signal,
            url: buildBraveSearchUrl(input),
            init: {
                headers: braveSearchHeaders(apiKey),
            },
        })
        if (!response.ok) {
            throw await responseError({
                providerId: this.id,
                response,
                timeoutMs: remainingTimeoutMs(startedAt, timeoutMs),
                signal: input.signal,
            })
        }

        const results = parseBraveSearchResults(
            await readResponseJsonWithTimeout({
                providerId: this.id,
                response,
                timeoutMs: remainingTimeoutMs(startedAt, timeoutMs),
                signal: input.signal,
            }),
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
        .map((entry, index) =>
            publicHttpSearchResultFromUnknown({
                entry,
                index,
                engine: 'brave',
                fetchedAt,
                snippet: braveSnippet,
            }),
        )
        .filter((entry): entry is WebSearchResult => entry !== null)
}

function braveSnippet(record: Record<string, unknown>): string {
    const snippets = [
        typeof record.description === 'string' ? record.description : '',
        ...(Array.isArray(record.extra_snippets)
            ? record.extra_snippets.filter(
                  (snippet): snippet is string => typeof snippet === 'string',
              )
            : []),
    ].filter((snippet) => snippet.trim().length > 0)
    return normalizeHtmlText(snippets.join(' '))
}
