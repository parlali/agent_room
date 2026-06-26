import { afterEach, describe, expect, it, vi } from 'vitest'
import {
    hostedRuntimeQuotaCallbackUrlEnvKey,
    hostedRuntimeRoomIdEnvKey,
    hostedRuntimeUsageCallbackTokenEnvKey,
    hostedRuntimeWorkspaceIdEnvKey,
} from '../rooms/pi-runtime-contract'
import { assertHostedRuntimeQuota } from './hosted-runtime-quota'

const hostedQuotaEnvKeys = [
    hostedRuntimeQuotaCallbackUrlEnvKey,
    hostedRuntimeUsageCallbackTokenEnvKey,
    hostedRuntimeWorkspaceIdEnvKey,
    hostedRuntimeRoomIdEnvKey,
]

afterEach(() => {
    vi.unstubAllGlobals()
})

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

        await withHostedQuotaEnv(
            {
                [hostedRuntimeQuotaCallbackUrlEnvKey]: 'https://rooms.example.test/quota',
                [hostedRuntimeUsageCallbackTokenEnvKey]: 'runtime-token',
                [hostedRuntimeWorkspaceIdEnvKey]: 'workspace_1',
                [hostedRuntimeRoomIdEnvKey]: 'room_1',
            },
            async () => {
                await assertHostedRuntimeQuota({
                    action: 'image_generation',
                    amount: {
                        count: 2,
                    },
                    sessionKey: 'session_1',
                    runId: 'run_1',
                })
            },
        )

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
})
