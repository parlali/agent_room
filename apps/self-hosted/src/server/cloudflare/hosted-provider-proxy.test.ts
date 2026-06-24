import { describe, expect, it } from 'vitest'
import {
    openRouterCostMicrosFromProviderPayload,
    openRouterCostMicrosFromProviderText,
} from './hosted-provider-proxy'

describe('hosted provider cost extraction', () => {
    it('uses OpenRouter usage.cost without estimating from token counts', () => {
        expect(
            openRouterCostMicrosFromProviderPayload({
                usage: {
                    prompt_tokens: 100,
                    completion_tokens: 50,
                    total_tokens: 150,
                    cost: 0.012345,
                },
            }),
        ).toBe(12345)
        expect(
            openRouterCostMicrosFromProviderPayload({
                usage: {
                    prompt_tokens: 100,
                    completion_tokens: 50,
                    total_tokens: 150,
                },
            }),
        ).toBeNull()
        expect(
            openRouterCostMicrosFromProviderPayload({
                cost: 0.99,
                usage: {
                    prompt_tokens: 100,
                    completion_tokens: 50,
                    total_tokens: 150,
                },
            }),
        ).toBeNull()
        expect(
            openRouterCostMicrosFromProviderPayload({
                usage: {
                    total_cost: 0.99,
                },
            }),
        ).toBeNull()
        expect(
            openRouterCostMicrosFromProviderPayload({
                choices: [
                    {
                        usage: {
                            cost: 0.99,
                        },
                    },
                ],
            }),
        ).toBeNull()
    })

    it('does not infer Brave search cost from response shape', () => {
        expect(
            openRouterCostMicrosFromProviderPayload({
                type: 'search',
                query: {
                    original: 'agent orchestration',
                },
                web: {
                    results: [
                        {
                            title: 'Result',
                            url: 'https://example.test',
                        },
                    ],
                },
            }),
        ).toBeNull()
    })

    it('extracts OpenRouter cost from buffered JSON and SSE provider bodies', () => {
        expect(
            openRouterCostMicrosFromProviderText(
                JSON.stringify({
                    usage: {
                        cost: '0.000042',
                    },
                }),
            ),
        ).toBe(42)
        expect(
            openRouterCostMicrosFromProviderText(
                [
                    'data: {"choices":[{"delta":{"content":"hi"}}]}',
                    'data: {"usage":{"cost":0.000123}}',
                    'data: [DONE]',
                ].join('\n'),
            ),
        ).toBe(123)
        expect(openRouterCostMicrosFromProviderText('data: {"usage":{}}\n')).toBeNull()
        expect(openRouterCostMicrosFromProviderText('{not-json')).toBeNull()
    })
})
