import { afterEach, describe, expect, it, vi } from 'vitest'
import { validateMaterializedSearchProviders } from './search-connection-validation'

vi.mock('./operator-configuration/materialization', () => ({
    materializeSearchConfig: vi.fn(async () => ({
        search: {
            enabled: false,
            backendUrl: 'http://127.0.0.1:8888',
            defaultResultCount: 5,
            timeoutMs: 10000,
            maxSearchesPerRun: 20,
            brave: {
                enabled: false,
                envKey: null,
                country: null,
                searchLang: null,
                safeSearch: 'moderate',
                timeoutMs: 10000,
                resultCount: 5,
            },
            browserbase: {
                enabled: true,
                envKey: 'AGENT_ROOM_SEARCH_BROWSERBASE_API_KEY',
                baseUrl: null,
                timeoutMs: 10000,
                resultCount: 5,
            },
        },
        entitlements: {
            env: {
                AGENT_ROOM_SEARCH_BROWSERBASE_API_KEY: 'browserbase-secret',
            },
            secretRefs: [],
        },
    })),
}))

const originalFetch = globalThis.fetch

describe('search connection validation', () => {
    afterEach(() => {
        globalThis.fetch = originalFetch
    })

    it('validates Browserbase through the same Search API path rooms use', async () => {
        const fetchUrls: string[] = []
        const fetchBodies: unknown[] = []
        globalThis.fetch = (async (input, init) => {
            fetchUrls.push(String(input))
            fetchBodies.push(JSON.parse(String(init?.body ?? '{}')))
            return new Response(
                JSON.stringify({
                    results: [
                        {
                            id: 'result-1',
                            title: 'Validated result',
                            url: 'https://example.com/validated',
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

        await expect(
            validateMaterializedSearchProviders({
                searchConfig: {},
                providers: ['browserbase'],
            }),
        ).resolves.toBeUndefined()

        expect(fetchUrls).toEqual(['https://api.browserbase.com/v1/search'])
        expect(fetchUrls.join('\n')).not.toContain('/sessions')
        expect(fetchBodies).toEqual([
            {
                query: 'agent room search validation',
                numResults: 1,
            },
        ])
    })
})
