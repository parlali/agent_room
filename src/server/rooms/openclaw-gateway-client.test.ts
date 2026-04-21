import { describe, expect, it, vi } from 'vitest'
import { __testing } from './openclaw-execution-adapter'

describe('openclaw gateway client integration seam', () => {
    it('builds the official gateway client runtime spec expected by the room adapter', () => {
        expect(
            __testing.buildGatewayRuntimeClientSpec({
                port: 46607,
                token: 'room-token',
                caps: ['tool-events'],
            }),
        ).toMatchObject({
            url: 'ws://127.0.0.1:46607',
            token: 'room-token',
            clientName: 'gateway-client',
            clientDisplayName: 'agent-room',
            clientVersion: 'agent-room',
            platform: process.platform,
            mode: 'backend',
            role: 'operator',
            scopes: ['operator.admin', 'operator.read', 'operator.write'],
            caps: ['tool-events'],
        })
    })

    it('wraps the official gateway client and delegates requests and shutdown', async () => {
        const request = vi.fn(
            async <T = unknown>() =>
                ({
                    ok: true,
                }) as T,
        )
        const stopAndWait = vi.fn(async () => {})

        const client = await __testing.connectGatewayClient(
            {
                port: 46607,
                token: 'room-token',
            },
            {
                createRuntimeClient: (async () => ({
                    request,
                    start: vi.fn(),
                    stop: vi.fn(),
                    stopAndWait,
                })) as never,
            },
        )

        await expect(client.requestRaw('agents.list', {})).resolves.toEqual({
            ok: true,
        })
        expect(request).toHaveBeenCalledWith('agents.list', {})

        await client.close()
        expect(stopAndWait).toHaveBeenCalledWith({
            timeoutMs: 1_000,
        })
    })
})
