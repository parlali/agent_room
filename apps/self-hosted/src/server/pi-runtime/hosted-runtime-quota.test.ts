import { afterEach, describe, expect, it, vi } from 'vitest'
import {
    hostedRuntimeQuotaCallbackUrlEnvKey,
    hostedRuntimeRoomIdEnvKey,
    hostedRuntimeUsageCallbackTokenEnvKey,
    hostedRuntimeWorkspaceIdEnvKey,
} from '../rooms/pi-runtime-contract'
import { assertHostedRuntimeQuota } from './hosted-runtime-quota'
import { withToolRunContext } from './tool-run-context'

const hostedQuotaEnvKeys = [
    hostedRuntimeQuotaCallbackUrlEnvKey,
    hostedRuntimeUsageCallbackTokenEnvKey,
    hostedRuntimeWorkspaceIdEnvKey,
    hostedRuntimeRoomIdEnvKey,
]

afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
})

function hostedQuotaEnv(): Record<string, string> {
    return {
        [hostedRuntimeQuotaCallbackUrlEnvKey]: 'https://rooms.example.test/quota',
        [hostedRuntimeUsageCallbackTokenEnvKey]: 'runtime-token',
        [hostedRuntimeWorkspaceIdEnvKey]: 'workspace_1',
        [hostedRuntimeRoomIdEnvKey]: 'room_1',
    }
}

function abortError(): Error {
    const error = new Error('aborted')
    error.name = 'AbortError'
    return error
}

function abortAwareFetch() {
    return vi.fn((_url: string | URL | Request, init?: RequestInit) => {
        const signal = init?.signal
        return new Promise<Response>((_resolve, reject) => {
            if (signal?.aborted) {
                reject(abortError())
                return
            }
            signal?.addEventListener(
                'abort',
                () => {
                    reject(abortError())
                },
                {
                    once: true,
                },
            )
        })
    })
}

async function withHostedQuotaEnv(
    values: Record<string, string | undefined>,
    run: () => Promise<void>,
): Promise<void> {
    const previous = new Map<string, string | undefined>()
    for (const key of hostedQuotaEnvKeys) {
        previous.set(key, process.env[key])
        const value = values[key]
        if (value === undefined) {
            delete process.env[key]
        } else {
            process.env[key] = value
        }
    }
    try {
        await run()
    } finally {
        for (const [key, value] of previous) {
            if (value === undefined) {
                delete process.env[key]
            } else {
                process.env[key] = value
            }
        }
    }
}

describe('hosted runtime quota callback', () => {
    it('does nothing when the runtime is not hosted', async () => {
        const fetchMock = vi.fn()
        vi.stubGlobal('fetch', fetchMock)

        await withHostedQuotaEnv({}, async () => {
            await assertHostedRuntimeQuota({
                action: 'shell_command',
                amount: {
                    count: 1,
                },
            })
        })

        expect(fetchMock).not.toHaveBeenCalled()
    })

    it('fails closed when hosted quota configuration is partial', async () => {
        const fetchMock = vi.fn()
        vi.stubGlobal('fetch', fetchMock)

        await withHostedQuotaEnv(
            {
                [hostedRuntimeWorkspaceIdEnvKey]: 'workspace_1',
                [hostedRuntimeRoomIdEnvKey]: 'room_1',
            },
            async () => {
                await expect(
                    assertHostedRuntimeQuota({
                        action: 'shell_command',
                    }),
                ).rejects.toThrow('Hosted quota runtime configuration is incomplete')
            },
        )

        expect(fetchMock).not.toHaveBeenCalled()
    })

    it('posts the runtime quota payload with callback credentials', async () => {
        const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true })))
        vi.stubGlobal('fetch', fetchMock)

        await withHostedQuotaEnv(hostedQuotaEnv(), async () => {
            await assertHostedRuntimeQuota({
                action: 'image_generation',
                amount: {
                    count: 2,
                },
                sessionKey: 'session_1',
                runId: 'run_1',
            })
        })

        expect(fetchMock).toHaveBeenCalledWith(
            'https://rooms.example.test/quota',
            expect.objectContaining({
                method: 'POST',
                headers: {
                    authorization: 'Bearer runtime-token',
                    'content-type': 'application/json',
                },
                body: JSON.stringify({
                    workspaceId: 'workspace_1',
                    roomId: 'room_1',
                    action: 'image_generation',
                    amount: {
                        count: 2,
                    },
                    sessionKey: 'session_1',
                    runId: 'run_1',
                    jobId: null,
                }),
            }),
        )
    })

    it('surfaces the denial reason from the callback response', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(
                async () =>
                    new Response(JSON.stringify({ reason: 'quota exceeded' }), {
                        status: 429,
                    }),
            ),
        )

        await withHostedQuotaEnv(hostedQuotaEnv(), async () => {
            await expect(
                assertHostedRuntimeQuota({
                    action: 'shell_command',
                }),
            ).rejects.toThrow('quota exceeded')
        })
    })

    it.each([
        ['missing ok', () => new Response(JSON.stringify({ ok: false }))],
        ['non-json body', () => new Response('<html></html>')],
        ['empty body', () => new Response(null, { status: 204 })],
    ])('rejects invalid success responses from the callback: %s', async (_name, response) => {
        vi.stubGlobal(
            'fetch',
            vi.fn(async () => response()),
        )

        await withHostedQuotaEnv(hostedQuotaEnv(), async () => {
            await expect(
                assertHostedRuntimeQuota({
                    action: 'shell_command',
                }),
            ).rejects.toThrow('Hosted quota callback returned an invalid success response')
        })
    })

    it('times out stalled quota callbacks', async () => {
        vi.useFakeTimers()
        const fetchMock = abortAwareFetch()
        vi.stubGlobal('fetch', fetchMock)

        const pending = expect(
            withHostedQuotaEnv(hostedQuotaEnv(), async () => {
                await assertHostedRuntimeQuota({
                    action: 'shell_command',
                })
            }),
        ).rejects.toThrow('Hosted quota callback timed out')

        await vi.advanceTimersByTimeAsync(5000)
        await pending
        expect(fetchMock).toHaveBeenCalled()
    })

    it('aborts the callback when the tool run is aborted', async () => {
        const fetchMock = abortAwareFetch()
        vi.stubGlobal('fetch', fetchMock)
        const controller = new AbortController()
        controller.abort()

        await withHostedQuotaEnv(hostedQuotaEnv(), async () => {
            await expect(
                withToolRunContext(
                    {
                        sessionKey: 'session_1',
                        runId: 'run_1',
                        signal: controller.signal,
                    },
                    () =>
                        assertHostedRuntimeQuota({
                            action: 'shell_command',
                        }),
                ),
            ).rejects.toThrow('Hosted quota callback aborted')
        })
        expect(fetchMock).toHaveBeenCalled()
    })
})
