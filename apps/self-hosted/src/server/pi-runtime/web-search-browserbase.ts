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

const browserbaseSearchApiUrl = 'https://api.browserbase.com/v1/search'

function browserbaseSearchUrl(config: SearchRuntimeConfigScope): string {
    const baseUrl = config.search.browserbase.baseUrl
    if (!baseUrl) {
        return browserbaseSearchApiUrl
    }
    return `${baseUrl.replace(/\/$/, '')}/search`
}

export class BrowserbaseSearchProvider implements SearchProvider {
    id = 'browserbase' as const
    label = 'Browserbase Search'
    priority = 20

    isConfigured(config: SearchRuntimeConfigScope): boolean {
        const envKey = config.search.browserbase.envKey
        return (
            config.search.enabled &&
            config.search.browserbase.enabled &&
            Boolean(envKey && process.env[envKey])
        )
    }

    async search(input: SearchProviderSearchInput): Promise<SearchProviderResponse> {
        const envKey = input.config.search.browserbase.envKey
        const apiKey = envKey ? process.env[envKey] : null
        if (!apiKey) {
            throw new SearchProviderError({
                code: 'misconfigured',
                providerId: this.id,
                message: 'Browserbase API key is not materialized',
            })
        }

        const timeoutMs = input.config.search.browserbase.timeoutMs
        const startedAt = Date.now()
        const response = await fetchWithTimeout({
            providerId: this.id,
            timeoutMs,
            signal: input.signal,
            url: browserbaseSearchUrl(input.config),
            init: {
                method: 'POST',
                headers: {
                    accept: 'application/json',
                    'content-type': 'application/json',
                    'user-agent': 'AgentRoom/1.0',
                    'x-bb-api-key': apiKey,
                },
                body: JSON.stringify({
                    query: input.query.trim(),
                    numResults: Math.min(
                        25,
                        input.count || input.config.search.browserbase.resultCount,
                    ),
                }),
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

        const results = parseBrowserbaseSearchResults(
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

export function parseBrowserbaseSearchResults(
    value: unknown,
    fetchedAt: string,
): WebSearchResult[] {
    const results =
        value && typeof value === 'object' && !Array.isArray(value)
            ? (value as { results?: unknown }).results
            : null
    if (!Array.isArray(results)) return []
    return results
        .map((entry, index) =>
            publicHttpSearchResultFromUnknown({
                entry,
                index,
                engine: 'browserbase',
                fetchedAt,
                snippet: browserbaseSnippet,
            }),
        )
        .filter((entry): entry is WebSearchResult => entry !== null)
}

function browserbaseSnippet(record: Record<string, unknown>): string {
    if (typeof record.description === 'string' && record.description.trim()) {
        return normalizeHtmlText(record.description)
    }
    if (typeof record.snippet === 'string' && record.snippet.trim()) {
        return normalizeHtmlText(record.snippet)
    }
    return [
        typeof record.author === 'string' && record.author.trim()
            ? `Author: ${record.author.trim()}`
            : null,
        typeof record.publishedDate === 'string' && record.publishedDate.trim()
            ? `Published: ${record.publishedDate.trim()}`
            : null,
    ]
        .filter((entry): entry is string => entry !== null)
        .join(' ')
}
