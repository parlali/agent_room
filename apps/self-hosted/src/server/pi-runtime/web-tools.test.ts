import { afterEach, describe, expect, it } from 'vitest'
import {
    createWebTools,
    parseBraveSearchResults,
    parseBrowserbaseSearchResults,
    parseSearxngResults,
} from './web-tools'
import { SearchProviderError } from './web-search'
import { BraveSearchProvider } from './web-search-brave'
import { BrowserbaseSearchProvider } from './web-search-browserbase'
import { SearchRouter } from './web-search-router'
import { parseSearxngHtmlResults, SearxngSearchProvider, searxngSearch } from './web-search-searxng'
import { createTestPiRuntimeConfig } from './test-runtime-defaults'
import { withToolRunContext } from './tool-run-context'
import {
    installHostedProviderReservationFetchRecorder,
    withHostedProviderReservationCollection,
} from './hosted-provider-reservation-context'
import {
    FakeSearchProvider,
    executeWebTool,
    resetWebToolTestGlobals,
    resultDetails,
} from './web-tools-test-support'

describe('web tools', () => {
    afterEach(resetWebToolTestGlobals)

    it('routes fetch_url through the managed hosted fetch proxy when configured', async () => {
        process.env.AGENT_ROOM_HOSTED_USAGE_CALLBACK_TOKEN = 'runtime-token-value-123456'
        const requests: Array<{ url: string; headers: Headers; body: unknown }> = []
        globalThis.fetch = (async (input, init) => {
            requests.push({
                url: String(input),
                headers: new Headers(init?.headers),
                body: JSON.parse(String(init?.body ?? '{}')),
            })
            return new Response(
                JSON.stringify({
                    url: 'https://example.com/page',
                    finalUrl: 'https://example.com/page',
                    status: 200,
                    contentType: 'text/html',
                    title: 'Example',
                    text: 'Example page',
                    byteLength: 42,
                    truncated: false,
                }),
                {
                    headers: {
                        'content-type': 'application/json',
                    },
                },
            )
        }) as typeof fetch
        const events: Array<{ event: string; payload: unknown }> = []
        const tools = createWebTools({
            config: createTestPiRuntimeConfig({
                urlFetch: {
                    mode: 'managed',
                    proxyUrl:
                        'https://rooms.example.test/api/hosted/runtime/fetch/workspaces/workspace_1/rooms/room_1',
                    tokenEnvKey: 'AGENT_ROOM_HOSTED_USAGE_CALLBACK_TOKEN',
                },
            }),
            audit: async (event, payload) => {
                events.push({ event, payload })
            },
        })
        const tool = tools.find((entry) => entry.name === 'fetch_url')
        if (!tool) {
            throw new Error('Missing fetch_url tool')
        }
        const runContext = {
            sessionKey: 'thread_1',
            runId: 'run_1',
            jobId: 'job_1',
        }
        const abortController = new AbortController()
        const uninstallRecorder = installHostedProviderReservationFetchRecorder()

        const { result } = await (async () => {
            try {
                return await withHostedProviderReservationCollection(
                    () =>
                        withToolRunContext(
                            {
                                ...runContext,
                                signal: abortController.signal,
                            },
                            () =>
                                tool.execute(
                                    'call-1',
                                    {
                                        url: 'https://example.com/page?secret=1',
                                    },
                                    undefined,
                                    undefined,
                                    {} as never,
                                ),
                        ),
                    runContext,
                )
            } finally {
                uninstallRecorder()
            }
        })()

        expect(requests).toHaveLength(1)
        expect(requests[0]!.url).toBe(
            'https://rooms.example.test/api/hosted/runtime/fetch/workspaces/workspace_1/rooms/room_1',
        )
        expect(requests[0]!.headers.get('authorization')).toBe('Bearer runtime-token-value-123456')
        const usageRequestId = requests[0]!.headers.get('x-agent-room-usage-request-id')
        expect(usageRequestId).toEqual(expect.stringMatching(/^[0-9a-f-]{36}$/))
        expect(requests[0]!.headers.get('x-agent-room-session-key')).toBe('thread_1')
        expect(requests[0]!.headers.get('x-agent-room-run-id')).toBe('run_1')
        expect(requests[0]!.headers.get('x-agent-room-job-id')).toBe('job_1')
        expect(requests[0]!.body).toMatchObject({
            url: 'https://example.com/page?secret=1',
        })
        expect(resultDetails(result)).toMatchObject({
            finalUrl: 'https://example.com/page',
            status: 200,
        })
        expect(events).toEqual([
            {
                event: 'tool.fetch_url',
                payload: expect.objectContaining({
                    provider: 'fetch_url',
                    source: 'managed',
                }),
            },
        ])
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

    it('preserves SearXNG unresponsive engine failure messages', async () => {
        globalThis.fetch = (async () =>
            new Response(
                JSON.stringify({
                    results: [
                        {
                            title: 'First',
                            url: 'https://example.com/first',
                            content: 'First result',
                            engines: ['duckduckgo'],
                        },
                    ],
                    unresponsive_engines: [['google', 'rate limit']],
                }),
                {
                    status: 200,
                    headers: {
                        'content-type': 'application/json',
                    },
                },
            )) as typeof fetch

        const response = await new SearxngSearchProvider().search({
            config: createTestPiRuntimeConfig(),
            query: 'first',
            count: 5,
        })

        expect(response.engineFailures).toEqual([
            {
                engine: 'google',
                code: 'rate_limited',
                reason: 'rate limit',
            },
        ])
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

    it('uses the configured Brave subscription token for direct BYOK search requests', async () => {
        process.env.AGENT_ROOM_SEARCH_BRAVE_API_KEY = 'brave-secret'
        const requests: Array<{ url: string; headers: Headers }> = []
        globalThis.fetch = (async (request, init) => {
            const url = request instanceof Request ? request.url : String(request)
            requests.push({
                url,
                headers: new Headers(
                    init?.headers ?? (request instanceof Request ? request.headers : undefined),
                ),
            })
            return new Response(
                JSON.stringify({
                    web: {
                        results: [
                            {
                                title: 'Example Domain',
                                url: 'https://example.com/',
                                description: 'Result',
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
            )
        }) as typeof fetch

        const provider = new BraveSearchProvider()
        await provider.search({
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
            query: 'brave search',
            count: 1,
        })

        expect(requests).toHaveLength(1)
        expect(requests[0]!.url).toContain('https://api.search.brave.com/res/v1/web/search')
        expect(requests[0]!.headers.get('x-subscription-token')).toBe('brave-secret')
        expect(requests[0]!.headers.has('authorization')).toBe(false)
    })

    it('uses the configured Brave proxy URL for managed search requests', async () => {
        process.env.AGENT_ROOM_SEARCH_BRAVE_API_KEY = 'runtime-token-value-123456'
        const requests: Array<{ url: string; headers: Headers }> = []
        globalThis.fetch = (async (request, init) => {
            const url = request instanceof Request ? request.url : String(request)
            requests.push({
                url,
                headers: new Headers(
                    init?.headers ?? (request instanceof Request ? request.headers : undefined),
                ),
            })
            return new Response(
                JSON.stringify({
                    web: {
                        results: [
                            {
                                title: 'Example Domain',
                                url: 'https://example.com/',
                                description: 'Result',
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
            )
        }) as typeof fetch

        const provider = new BraveSearchProvider()
        await provider.search({
            config: createTestPiRuntimeConfig({
                search: {
                    brave: {
                        enabled: true,
                        envKey: 'AGENT_ROOM_SEARCH_BRAVE_API_KEY',
                        baseUrl:
                            'https://rooms.example.test/api/hosted/runtime/provider/brave/v1/workspaces/workspace_1/rooms/room_1/res/v1/web/search',
                    },
                },
            }),
            query: 'managed brave search',
            count: 1,
        })

        expect(requests).toHaveLength(1)
        expect(requests[0]!.url).toContain(
            'https://rooms.example.test/api/hosted/runtime/provider/brave/v1/workspaces/workspace_1/rooms/room_1/res/v1/web/search',
        )
        expect(requests[0]!.url).toContain('q=managed+brave+search')
        expect(requests[0]!.headers.get('x-subscription-token')).toBe('runtime-token-value-123456')
        expect(requests[0]!.headers.has('authorization')).toBe(false)
    })

    it('treats provider-level search config as disabled when top-level search is disabled', () => {
        process.env.AGENT_ROOM_SEARCH_BRAVE_API_KEY = 'brave-secret'
        process.env.AGENT_ROOM_SEARCH_BROWSERBASE_API_KEY = 'browserbase-secret'
        const config = createTestPiRuntimeConfig({
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
                    enabled: true,
                    envKey: 'AGENT_ROOM_SEARCH_BROWSERBASE_API_KEY',
                    timeoutMs: 10000,
                    resultCount: 5,
                },
            },
        })

        expect(new BraveSearchProvider().isConfigured(config)).toBe(false)
        expect(new BrowserbaseSearchProvider().isConfigured(config)).toBe(false)
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

    it('preserves caller aborts while reading provider response bodies', async () => {
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
        const controller = new AbortController()
        const promise = provider.search({
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
                },
            }),
            query: 'cancelled body',
            count: 1,
            signal: controller.signal,
        })

        controller.abort()

        await expect(promise).rejects.toMatchObject({
            code: 'aborted',
            retryable: false,
        })
    })

    it('maps Browserbase Search API results into canonical search results', () => {
        const results = parseBrowserbaseSearchResults(
            {
                results: [
                    {
                        title: 'Browserbase result',
                        url: 'https://example.com/browserbase',
                        author: 'Example Publisher',
                        publishedDate: '2026-05-03',
                    },
                    {
                        title: 'Ignored',
                        url: 'about:blank',
                    },
                ],
            },
            '2026-05-03T10:00:00.000Z',
        )

        expect(results).toEqual([
            {
                title: 'Browserbase result',
                url: 'https://example.com/browserbase',
                snippet: 'Author: Example Publisher Published: 2026-05-03',
                engine: 'browserbase',
                fetchedAt: '2026-05-03T10:00:00.000Z',
                rank: 1,
            },
        ])
    })

    it('uses Browserbase Search API without sessions, CDP, or Brave page scraping', async () => {
        process.env.AGENT_ROOM_SEARCH_BROWSERBASE_API_KEY = 'browserbase-secret'
        const fetchUrls: string[] = []
        const fetchBodies: unknown[] = []
        globalThis.fetch = (async (input, init) => {
            const url = String(input)
            fetchUrls.push(url)
            fetchBodies.push(JSON.parse(String(init?.body ?? '{}')))
            return new Response(
                JSON.stringify({
                    results: [
                        {
                            title: 'Browserbase direct',
                            url: 'https://example.com/direct',
                            snippet: 'From Browserbase Search API',
                        },
                    ],
                }),
                {
                    status: 200,
                    headers: {
                        'content-type': 'application/json',
                    },
                },
            )
        }) as typeof fetch

        class ForbiddenWebSocket extends EventTarget {
            constructor() {
                super()
                throw new Error('Browserbase Search API must not open CDP')
            }
        }
        globalThis.WebSocket = ForbiddenWebSocket as unknown as typeof WebSocket
        const provider = new BrowserbaseSearchProvider()

        const response = await provider.search({
            config: createTestPiRuntimeConfig({
                search: {
                    enabled: false,
                    browserbase: {
                        enabled: true,
                        envKey: 'AGENT_ROOM_SEARCH_BROWSERBASE_API_KEY',
                        timeoutMs: 10000,
                        resultCount: 5,
                    },
                },
            }),
            query: 'browserbase direct search',
            count: 3,
        })

        expect(fetchUrls).toEqual(['https://api.browserbase.com/v1/search'])
        expect(fetchUrls.join('\n')).not.toContain('/sessions')
        expect(fetchUrls.join('\n')).not.toContain('search.brave.com')
        expect(fetchBodies).toEqual([
            {
                query: 'browserbase direct search',
                numResults: 3,
            },
        ])
        expect(response).toMatchObject({
            backendFormat: 'api',
            browserMediated: false,
            results: [
                {
                    title: 'Browserbase direct',
                    url: 'https://example.com/direct',
                    snippet: 'From Browserbase Search API',
                    engine: 'browserbase',
                    rank: 1,
                },
            ],
        })
    })

    it('bounds Browserbase Search API body stalls by timeout', async () => {
        process.env.AGENT_ROOM_SEARCH_BROWSERBASE_API_KEY = 'browserbase-secret'
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
    })

    it('preserves caller aborts during provider requests', async () => {
        process.env.AGENT_ROOM_SEARCH_BROWSERBASE_API_KEY = 'browserbase-secret'
        globalThis.fetch = (async (_input, init) =>
            new Promise<Response>((_resolve, reject) => {
                const signal = init?.signal
                const rejectAbort = () => reject(new DOMException('aborted', 'AbortError'))
                signal?.addEventListener('abort', rejectAbort, { once: true })
                if (signal?.aborted) {
                    rejectAbort()
                }
            })) as typeof fetch
        const provider = new BrowserbaseSearchProvider()
        const controller = new AbortController()
        const promise = provider.search({
            config: createTestPiRuntimeConfig({
                search: {
                    enabled: false,
                    browserbase: {
                        enabled: true,
                        envKey: 'AGENT_ROOM_SEARCH_BROWSERBASE_API_KEY',
                        timeoutMs: 10000,
                        resultCount: 5,
                    },
                },
            }),
            query: 'cancelled browserbase search',
            count: 1,
            signal: controller.signal,
        })

        controller.abort()

        await expect(promise).rejects.toMatchObject({
            code: 'aborted',
            retryable: false,
        })
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
                    backendFormat: 'api',
                    fallbackReason: null,
                    degradedReason: null,
                    browserMediated: false,
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
        expect(response.browserMediated).toBe(false)
        expect(response.fallbackChain.map((step) => step.status)).toEqual(['failed', 'complete'])
        expect(audits).toContain('search.provider_retrying')
        expect(audits).toContain('search.provider_completed')
    })

    it('does not retry or fall back after caller-aborted search', async () => {
        const brave = new FakeSearchProvider({
            id: 'brave',
            label: 'Brave',
            priority: 10,
            implementation: () => {
                throw new SearchProviderError({
                    code: 'aborted',
                    providerId: 'brave',
                    retryable: false,
                    message: 'Brave search was cancelled',
                })
            },
        })
        const browserbase = new FakeSearchProvider({
            id: 'browserbase',
            label: 'Browserbase',
            priority: 20,
            implementation: () => ({
                results: [
                    {
                        title: 'Should not run',
                        url: 'https://example.com/should-not-run',
                        snippet: 'Fallback should not run',
                        engine: 'browserbase',
                        fetchedAt: '2026-05-03T10:00:00.000Z',
                        rank: 1,
                    },
                ],
                backendFormat: 'api',
                fallbackReason: null,
                degradedReason: null,
                browserMediated: false,
            }),
        })
        const router = new SearchRouter([browserbase, brave])

        await expect(
            router.search({
                config: createTestPiRuntimeConfig(),
                query: 'cancelled search',
                count: 1,
            }),
        ).rejects.toMatchObject({
            code: 'aborted',
            retryable: false,
        })

        expect(brave.calls).toBe(1)
        expect(browserbase.calls).toBe(0)
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
                                timeoutMs: 10000,
                                resultCount: 5,
                            },
                            backendUrl: 'http://127.0.0.1:9999',
                            enabled: true,
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
                        timeoutMs: 10000,
                        resultCount: 5,
                    },
                },
            }),
            audit: async (event, payload) => {
                events.push({ event, payload })
            },
        })
        const tool = tools.find((entry) => entry.name === 'web_search')
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
})
