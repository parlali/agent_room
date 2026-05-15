import { afterEach, describe, expect, it } from 'vitest'
import {
    assertSafeUrl,
    createWebTools,
    isBlockedNetworkAddress,
    normalizeSearxngSafeSearch,
    parseBraveSearchResults,
    parseBrowserExtractedSearchResults,
    parseSearxngResults,
    sanitizeUrlForAudit,
} from './web-tools'
import {
    SearchProviderError,
    type SearchProvider,
    type SearchProviderSearchInput,
    type SearchProviderResponse,
} from './web-search'
import { BraveSearchProvider } from './web-search-brave'
import { BrowserbaseSearchProvider } from './web-search-browserbase'
import { SearchRouter } from './web-search-router'
import { parseSearxngHtmlResults, searxngSearch } from './web-search-searxng'
import { createTestPiRuntimeConfig } from './test-runtime-defaults'
import { withToolRunContext } from './tool-run-context'

const originalFetch = globalThis.fetch
const originalBraveKey = process.env.AGENT_ROOM_SEARCH_BRAVE_API_KEY
const originalBrowserbaseKey = process.env.AGENT_ROOM_SEARCH_BROWSERBASE_API_KEY
const originalWebSocket = globalThis.WebSocket

async function executeWebTool(input: object) {
    const events: Array<{ event: string; payload: unknown }> = []
    const tools = createWebTools({
        config: createTestPiRuntimeConfig({
            search: {
                brave: {
                    enabled: true,
                    envKey: 'AGENT_ROOM_SEARCH_BRAVE_API_KEY',
                    country: null,
                    searchLang: null,
                    safeSearch: 'moderate',
                    timeoutMs: 10000,
                    resultCount: 5,
                },
            },
        }),
        audit: async (event, payload) => {
            events.push({ event, payload })
        },
    })
    const tool = tools.find((entry) => entry.name === 'agent_room_web_search')
    if (!tool) {
        throw new Error('Missing web search tool')
    }
    const result = await tool.execute('call-1', input as never, undefined, undefined, {} as never)
    return {
        result,
        events,
    }
}

function resultDetails(result: Awaited<ReturnType<typeof executeWebTool>>['result']) {
    return typeof result.details === 'object' && result.details !== null
        ? (result.details as Record<string, unknown>)
        : {}
}

class FakeSearchProvider implements SearchProvider {
    id
    label
    priority
    calls = 0
    private implementation

    constructor(input: {
        id: SearchProvider['id']
        label: string
        priority: number
        implementation: (input: SearchProviderSearchInput, calls: number) => SearchProviderResponse
    }) {
        this.id = input.id
        this.label = input.label
        this.priority = input.priority
        this.implementation = input.implementation
    }

    isConfigured(): boolean {
        return true
    }

    async search(input: SearchProviderSearchInput): Promise<SearchProviderResponse> {
        this.calls += 1
        return this.implementation(input, this.calls)
    }
}

describe('web tools', () => {
    afterEach(() => {
        globalThis.fetch = originalFetch
        if (originalBraveKey === undefined) {
            delete process.env.AGENT_ROOM_SEARCH_BRAVE_API_KEY
        } else {
            process.env.AGENT_ROOM_SEARCH_BRAVE_API_KEY = originalBraveKey
        }
        if (originalBrowserbaseKey === undefined) {
            delete process.env.AGENT_ROOM_SEARCH_BROWSERBASE_API_KEY
        } else {
            process.env.AGENT_ROOM_SEARCH_BROWSERBASE_API_KEY = originalBrowserbaseKey
        }
        globalThis.WebSocket = originalWebSocket
    })

    it('parses bounded SearXNG results into canonical search results', () => {
        const results = parseSearxngResults(
            {
                results: [
                    {
                        title: 'Example',
                        url: 'https://example.com/page',
                        content: 'A short result snippet.',
                        engines: ['duckduckgo', 'brave'],
                    },
                    {
                        title: '',
                        url: 'not-a-url',
                        content: 'ignored',
                    },
                ],
            },
            '2026-05-03T10:00:00.000Z',
        )

        expect(results).toEqual([
            {
                title: 'Example',
                url: 'https://example.com/page',
                snippet: 'A short result snippet.',
                engine: 'duckduckgo, brave',
                fetchedAt: '2026-05-03T10:00:00.000Z',
                rank: 1,
            },
        ])
    })

    it('parses SearXNG HTML results when JSON is unavailable', async () => {
        const results = await parseSearxngHtmlResults(
            `
            <article class="result result-default category-general">
                <h3><a href="https://openai.com/"><span>OpenAI</span> | Research</a></h3>
                <p class="content">OpenAI research and product updates.</p>
                <div class="engines"><span>duckduckgo</span><span>brave</span></div>
            </article>
            `,
            '2026-05-03T10:00:00.000Z',
        )

        expect(results).toEqual([
            {
                title: 'OpenAI | Research',
                url: 'https://openai.com/',
                snippet: 'OpenAI research and product updates.',
                engine: 'duckduckgo, brave',
                fetchedAt: '2026-05-03T10:00:00.000Z',
                rank: 1,
            },
        ])
    })

    it('falls back to bounded HTML parsing when SearXNG rejects JSON format', async () => {
        const calls: string[] = []
        globalThis.fetch = (async (input) => {
            const url = String(input)
            calls.push(url)
            if (url.includes('format=json')) {
                return new Response('Forbidden', {
                    status: 403,
                })
            }
            return new Response(
                `
                <article class="result result-default category-general">
                    <h3><a href="https://example.com/page">Example Result</a></h3>
                    <p class="content">A result from HTML fallback.</p>
                    <div class="engines"><span>startpage</span></div>
                </article>
                `,
                {
                    status: 200,
                    headers: {
                        'content-type': 'text/html',
                    },
                },
            )
        }) as typeof fetch

        const response = await searxngSearch({
            config: createTestPiRuntimeConfig(),
            query: 'example query',
            count: 5,
        })

        expect(calls).toHaveLength(2)
        expect(new URL(calls[0]).searchParams.get('format')).toBe('json')
        expect(new URL(calls[1]).searchParams.has('format')).toBe(false)
        expect(response.backendFormat).toBe('html')
        expect(response.fallbackReason).toContain('searxng search blocked returned 403')
        expect(response.results).toEqual([
            {
                title: 'Example Result',
                url: 'https://example.com/page',
                snippet: 'A result from HTML fallback.',
                engine: 'startpage',
                fetchedAt: expect.any(String),
                rank: 1,
            },
        ])
    })

    it('backs off rate-limited SearXNG engines on later routed searches', async () => {
        const calls: string[] = []
        globalThis.fetch = (async (input) => {
            const url = String(input)
            calls.push(url)
            const body =
                calls.length === 1
                    ? {
                          results: [
                              {
                                  title: 'First',
                                  url: 'https://example.com/first',
                                  content: 'First result',
                                  engines: ['duckduckgo'],
                              },
                          ],
                          unresponsive_engines: [['google', 'rate limit']],
                      }
                    : {
                          results: [
                              {
                                  title: 'Second',
                                  url: 'https://example.com/second',
                                  content: 'Second result',
                                  engines: ['duckduckgo'],
                              },
                          ],
                      }
            return new Response(JSON.stringify(body), {
                status: 200,
                headers: {
                    'content-type': 'application/json',
                },
            })
        }) as typeof fetch
        const router = new SearchRouter()

        await router.search({
            config: createTestPiRuntimeConfig(),
            query: 'first',
            count: 5,
        })
        await router.search({
            config: createTestPiRuntimeConfig(),
            query: 'second',
            count: 5,
        })

        expect(new URL(calls[1]).searchParams.get('disabled_engines')).toBe('google')
    })

    it('maps Brave web results into canonical search results', () => {
        const results = parseBraveSearchResults(
            {
                web: {
                    results: [
                        {
                            title: 'Example Domain',
                            url: 'https://example.com/',
                            description: 'Primary snippet',
                            extra_snippets: ['Additional snippet'],
                        },
                        {
                            title: 'Bad',
                            url: 'file:///tmp/bad',
                            description: 'ignored',
                        },
                    ],
                },
            },
            '2026-05-03T10:00:00.000Z',
        )

        expect(results).toEqual([
            {
                title: 'Example Domain',
                url: 'https://example.com/',
                snippet: 'Primary snippet Additional snippet',
                engine: 'brave',
                fetchedAt: '2026-05-03T10:00:00.000Z',
                rank: 1,
            },
        ])
    })

    it('bounds provider response body stalls after headers arrive', async () => {
        process.env.AGENT_ROOM_SEARCH_BRAVE_API_KEY = 'brave-secret'
        globalThis.fetch = (async () =>
            ({
                ok: true,
                status: 200,
                body: {
                    getReader: () => ({
                        read: () => new Promise(() => undefined),
                        cancel: () => Promise.resolve(),
                        releaseLock: () => undefined,
                    }),
                },
            }) as unknown as Response) as typeof fetch
        const provider = new BraveSearchProvider()
        const startedAt = Date.now()

        await expect(
            provider.search({
                config: createTestPiRuntimeConfig({
                    search: {
                        enabled: false,
                        brave: {
                            enabled: true,
                            envKey: 'AGENT_ROOM_SEARCH_BRAVE_API_KEY',
                            country: null,
                            searchLang: null,
                            safeSearch: 'moderate',
                            timeoutMs: 20,
                            resultCount: 5,
                        },
                    },
                }),
                query: 'stalled body',
                count: 1,
            }),
        ).rejects.toMatchObject({
            code: 'timeout',
        })

        expect(Date.now() - startedAt).toBeLessThan(500)
    })

    it('maps Browserbase browser-mediated extracted results into canonical search results', () => {
        const results = parseBrowserExtractedSearchResults(
            [
                {
                    title: 'Browser result',
                    url: 'https://example.com/browser',
                    snippet: 'Found through a browser page',
                },
                {
                    title: 'Ignored',
                    url: 'about:blank',
                    snippet: 'ignored',
                },
            ],
            '2026-05-03T10:00:00.000Z',
        )

        expect(results).toEqual([
            {
                title: 'Browser result',
                url: 'https://example.com/browser',
                snippet: 'Found through a browser page',
                engine: 'browserbase:brave',
                fetchedAt: '2026-05-03T10:00:00.000Z',
                rank: 1,
            },
        ])
    })

    it('bounds Browserbase CDP command and cleanup hangs by timeout', async () => {
        process.env.AGENT_ROOM_SEARCH_BROWSERBASE_API_KEY = 'browserbase-secret'
        const fetchUrls: string[] = []
        globalThis.fetch = (async (input, init) => {
            const url = String(input)
            fetchUrls.push(url)
            if (url.endsWith('/sessions')) {
                return new Response(
                    JSON.stringify({
                        id: 'session-1',
                        connectUrl: 'ws://browserbase.test/session-1',
                    }),
                    {
                        status: 200,
                        headers: {
                            'content-type': 'application/json',
                        },
                    },
                )
            }
            return new Promise<Response>((_resolve, reject) => {
                const signal = init?.signal
                const abort = () => {
                    const error = new Error('aborted')
                    Object.defineProperty(error, 'name', {
                        value: 'AbortError',
                    })
                    reject(error)
                }
                signal?.addEventListener('abort', abort, { once: true })
                if (signal?.aborted) {
                    abort()
                }
            })
        }) as typeof fetch

        class HangingWebSocket extends EventTarget {
            static CONNECTING = 0
            static OPEN = 1
            static CLOSING = 2
            static CLOSED = 3
            readyState = HangingWebSocket.CONNECTING

            constructor() {
                super()
                setTimeout(() => {
                    this.readyState = HangingWebSocket.OPEN
                    this.dispatchEvent(new Event('open'))
                }, 0)
            }

            send(): void {}

            close(): void {
                this.readyState = HangingWebSocket.CLOSED
                this.dispatchEvent(new Event('close'))
            }
        }
        globalThis.WebSocket = HangingWebSocket as unknown as typeof WebSocket
        const provider = new BrowserbaseSearchProvider()
        const startedAt = Date.now()

        await expect(
            provider.search({
                config: createTestPiRuntimeConfig({
                    search: {
                        enabled: false,
                        browserbase: {
                            enabled: true,
                            envKey: 'AGENT_ROOM_SEARCH_BROWSERBASE_API_KEY',
                            projectId: 'browserbase-project',
                            timeoutMs: 20,
                            resultCount: 5,
                        },
                    },
                }),
                query: 'hanging browserbase search',
                count: 1,
            }),
        ).rejects.toMatchObject({
            code: 'timeout',
        })

        expect(Date.now() - startedAt).toBeLessThan(500)
        expect(fetchUrls).toEqual([
            'https://api.browserbase.com/v1/sessions',
            'https://api.browserbase.com/v1/sessions/session-1',
        ])
    })

    it('routes providers by priority, retries transient failures, and records fallback metadata', async () => {
        const brave = new FakeSearchProvider({
            id: 'brave',
            label: 'Brave',
            priority: 10,
            implementation: () => {
                throw new SearchProviderError({
                    code: 'blocked',
                    providerId: 'brave',
                    message: 'Brave quota blocked',
                })
            },
        })
        const browserbase = new FakeSearchProvider({
            id: 'browserbase',
            label: 'Browserbase',
            priority: 20,
            implementation: (_input, calls) => {
                if (calls === 1) {
                    throw new SearchProviderError({
                        code: 'timeout',
                        providerId: 'browserbase',
                        retryable: true,
                        message: 'Browserbase timed out',
                    })
                }
                return {
                    results: [
                        {
                            title: 'Recovered',
                            url: 'https://example.com/recovered',
                            snippet: 'Recovered through fallback',
                            engine: 'browserbase:test',
                            fetchedAt: '2026-05-03T10:00:00.000Z',
                            rank: 1,
                        },
                    ],
                    backendFormat: 'browser',
                    fallbackReason: null,
                    degradedReason: null,
                    browserMediated: true,
                }
            },
        })
        const searxng = new FakeSearchProvider({
            id: 'searxng',
            label: 'SearXNG',
            priority: 30,
            implementation: () => {
                throw new Error('SearXNG should not be reached')
            },
        })
        const router = new SearchRouter([searxng, browserbase, brave])
        const audits: string[] = []

        const response = await router.search({
            config: createTestPiRuntimeConfig(),
            query: 'agent room',
            count: 5,
            audit: async (event) => {
                audits.push(event)
            },
        })

        expect(brave.calls).toBe(1)
        expect(browserbase.calls).toBe(2)
        expect(searxng.calls).toBe(0)
        expect(response.backend).toBe('browserbase')
        expect(response.degraded).toBe(true)
        expect(response.browserMediated).toBe(true)
        expect(response.fallbackChain.map((step) => step.status)).toEqual(['failed', 'complete'])
        expect(audits).toContain('search.provider_retrying')
        expect(audits).toContain('search.provider_completed')
    })

    it('deduplicates in-flight queries within a run and enforces search budget', async () => {
        const provider = new FakeSearchProvider({
            id: 'searxng',
            label: 'SearXNG',
            priority: 30,
            implementation: () => ({
                results: [
                    {
                        title: 'Result',
                        url: 'https://example.com/result',
                        snippet: 'snippet',
                        engine: 'test',
                        fetchedAt: '2026-05-03T10:00:00.000Z',
                        rank: 1,
                    },
                ],
                backendFormat: 'json',
                fallbackReason: null,
                degradedReason: null,
                browserMediated: false,
            }),
        })
        const router = new SearchRouter([provider])
        const config = createTestPiRuntimeConfig({
            search: {
                maxSearchesPerRun: 1,
            },
        })

        await withToolRunContext(
            {
                sessionKey: 'session-1',
                runId: 'run-1',
                signal: new AbortController().signal,
            },
            async () => {
                await Promise.all([
                    router.search({ config, query: 'same', count: 5 }),
                    router.search({ config, query: 'same', count: 5 }),
                ])
                await expect(
                    router.search({ config, query: 'different', count: 5 }),
                ).rejects.toThrow('Web search budget exhausted for this run')
            },
        )

        expect(provider.calls).toBe(1)
    })

    it('classifies Brave auth, quota, and rate-limit responses without empty success', async () => {
        const statuses = [
            { status: 401, code: 'misconfigured' },
            { status: 402, code: 'blocked' },
            { status: 429, code: 'rate_limited' },
        ] as const
        for (const entry of statuses) {
            globalThis.fetch = (async () =>
                new Response('provider failure', {
                    status: entry.status,
                })) as typeof fetch
            process.env.AGENT_ROOM_SEARCH_BRAVE_API_KEY = 'brave-secret'
            const router = new SearchRouter()
            await expect(
                router.search({
                    config: createTestPiRuntimeConfig({
                        search: {
                            brave: {
                                enabled: true,
                                envKey: 'AGENT_ROOM_SEARCH_BRAVE_API_KEY',
                                country: null,
                                searchLang: null,
                                safeSearch: 'moderate',
                                timeoutMs: 10000,
                                resultCount: 5,
                            },
                            browserbase: {
                                enabled: false,
                                envKey: null,
                                projectId: null,
                                timeoutMs: 10000,
                                resultCount: 5,
                            },
                            backendUrl: 'http://127.0.0.1:9999',
                            enabled: false,
                        },
                    }),
                    query: `failure ${entry.status}`,
                    count: 5,
                }),
            ).rejects.toMatchObject({
                code: entry.code,
            })
        }
    })

    it('does not expose provider response text through model-facing search failures', async () => {
        process.env.AGENT_ROOM_SEARCH_BRAVE_API_KEY = 'brave-secret'
        globalThis.fetch = (async () =>
            new Response('provider echoed secret browserbase-api-key-value', {
                status: 401,
            })) as typeof fetch

        const events: Array<{ event: string; payload: unknown }> = []
        const tools = createWebTools({
            config: createTestPiRuntimeConfig({
                search: {
                    enabled: false,
                    brave: {
                        enabled: true,
                        envKey: 'AGENT_ROOM_SEARCH_BRAVE_API_KEY',
                        country: null,
                        searchLang: null,
                        safeSearch: 'moderate',
                        timeoutMs: 10000,
                        resultCount: 5,
                    },
                    browserbase: {
                        enabled: false,
                        envKey: null,
                        projectId: null,
                        timeoutMs: 10000,
                        resultCount: 5,
                    },
                },
            }),
            audit: async (event, payload) => {
                events.push({ event, payload })
            },
        })
        const tool = tools.find((entry) => entry.name === 'agent_room_web_search')
        if (!tool) {
            throw new Error('Missing web search tool')
        }

        let thrown: unknown = null
        try {
            await tool.execute(
                'call-1',
                {
                    query: 'secret failure',
                    count: 1,
                } as never,
                undefined,
                undefined,
                {} as never,
            )
        } catch (error) {
            thrown = error
        }

        expect(thrown).toBeInstanceOf(SearchProviderError)
        expect(thrown instanceof Error ? thrown.message : String(thrown)).not.toContain(
            'browserbase-api-key-value',
        )

        expect(JSON.stringify(events)).not.toContain('browserbase-api-key-value')
    })

    it('surfaces backend and fallback metadata from the model-facing web search tool', async () => {
        process.env.AGENT_ROOM_SEARCH_BRAVE_API_KEY = 'brave-secret'
        globalThis.fetch = (async () =>
            new Response(
                JSON.stringify({
                    web: {
                        results: [
                            {
                                title: 'Brave Result',
                                url: 'https://example.com/brave',
                                description: 'From Brave',
                            },
                        ],
                    },
                }),
                {
                    status: 200,
                    headers: {
                        'content-type': 'application/json',
                    },
                },
            )) as typeof fetch

        const { result, events } = await executeWebTool({
            query: 'brave result',
            count: 1,
        })
        const details = resultDetails(result)

        expect(details.backend).toBe('brave')
        expect(details.backendLabel).toBe('Brave Search')
        expect(details.degraded).toBe(false)
        expect(details.resultCount).toBe(1)
        expect(details.fallbackChain).toEqual([
            {
                backend: 'brave',
                backendLabel: 'Brave Search',
                status: 'complete',
                attempts: 1,
                errorCode: null,
                reason: null,
            },
        ])
        expect(JSON.stringify(events)).not.toContain('brave-secret')
    })

    it('blocks local, private, link-local, and metadata network addresses', () => {
        expect(isBlockedNetworkAddress('127.0.0.1')).toBe(true)
        expect(isBlockedNetworkAddress('10.1.2.3')).toBe(true)
        expect(isBlockedNetworkAddress('172.20.1.1')).toBe(true)
        expect(isBlockedNetworkAddress('192.168.1.1')).toBe(true)
        expect(isBlockedNetworkAddress('169.254.169.254')).toBe(true)
        expect(isBlockedNetworkAddress('::1')).toBe(true)
        expect(isBlockedNetworkAddress('::ffff:127.0.0.1')).toBe(true)
        expect(isBlockedNetworkAddress('::ffff:7f00:1')).toBe(true)
        expect(isBlockedNetworkAddress('8.8.8.8')).toBe(false)
    })

    it('rejects unsafe fetch URL schemes and hostnames before network fetch', async () => {
        await expect(assertSafeUrl(new URL('file:///etc/passwd'))).rejects.toThrow(
            'Only http and https URLs can be fetched',
        )
        await expect(assertSafeUrl(new URL('http://localhost/status'))).rejects.toThrow(
            'Local and metadata hostnames cannot be fetched',
        )
        await expect(assertSafeUrl(new URL('http://[::1]/status'))).rejects.toThrow(
            'Local and private network addresses cannot be fetched',
        )
        await expect(
            assertSafeUrl(new URL('http://metadata.google.internal/computeMetadata/v1')),
        ).rejects.toThrow('Local and metadata hostnames cannot be fetched')
        await expect(
            assertSafeUrl(new URL('https://user:pass@example.com/private')),
        ).rejects.toThrow('URLs with embedded credentials cannot be fetched')
    })

    it('normalizes SearXNG safe search values before they reach the backend', () => {
        expect(normalizeSearxngSafeSearch('off')).toBe('0')
        expect(normalizeSearxngSafeSearch('moderate')).toBe('1')
        expect(normalizeSearxngSafeSearch('strict')).toBe('2')
        expect(() => normalizeSearxngSafeSearch('unbounded')).toThrow(
            'safeSearch must be off, moderate, strict, 0, 1, or 2',
        )
    })

    it('redacts URL credentials, queries, and fragments before audit persistence', () => {
        expect(sanitizeUrlForAudit('https://user:pass@example.com/path?token=secret#frag')).toBe(
            'https://example.com/path?[redacted]#[redacted]',
        )
    })
})
