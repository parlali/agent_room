import { afterEach, describe, expect, it, vi } from 'vitest'
import { validateHostedOpenRouterProvider } from './hosted-connection-validation'

describe('hosted provider connection validation', () => {
    afterEach(() => {
        vi.restoreAllMocks()
    })

    it('rejects OpenRouter probes that do not return exactly ok', async () => {
        vi.spyOn(globalThis, 'fetch').mockResolvedValue(
            new Response(
                JSON.stringify({
                    choices: [
                        {
                            message: {
                                content: 'ok, connected',
                            },
                        },
                    ],
                }),
                {
                    status: 200,
                    headers: {
                        'content-type': 'application/json',
                    },
                },
            ),
        )

        const result = await validateHostedOpenRouterProvider({
            publicOrigin: 'https://rooms.example.test',
            baseUrl: 'https://openrouter.ai/api/v1',
            model: 'openrouter/auto',
            apiKey: 'openrouter-key',
        })

        expect(result).toMatchObject({
            status: 'invalid',
        })
        expect(result.message).toContain('unexpected assistant text')
        expect(result.message).not.toContain('openrouter-key')
    })
})
