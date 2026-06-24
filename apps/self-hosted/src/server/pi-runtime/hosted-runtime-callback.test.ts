import { afterEach, describe, expect, it, vi } from 'vitest'
import { postHostedRuntimeCallback } from './hosted-runtime-callback'

describe('hosted runtime callback posting', () => {
    afterEach(() => {
        vi.unstubAllGlobals()
        vi.restoreAllMocks()
    })

    it.each([403, 409])('does not retry terminal control-plane status %s', async (status) => {
        const fetchMock = vi.fn(async () => new Response('{}', { status }))
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
        vi.stubGlobal('fetch', fetchMock)

        await expect(
            postHostedRuntimeCallback({
                url: 'https://rooms.example.test/api/hosted/runtime/usage',
                token: 'runtime-token-value-123456',
                label: 'usage',
                body: {
                    workspaceId: 'workspace_1',
                    roomId: 'room_1',
                },
            }),
        ).rejects.toThrow(`usage callback failed with status ${status}`)

        expect(fetchMock).toHaveBeenCalledTimes(1)
        expect(warn).toHaveBeenCalledTimes(1)
    })
})
