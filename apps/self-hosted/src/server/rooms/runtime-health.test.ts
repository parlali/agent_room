import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { describe, expect, it } from 'vitest'
import { collectRuntimeHealthSnapshot } from './runtime-health'

async function withHealthServer<T>(payload: unknown, fn: (port: number) => Promise<T>): Promise<T> {
    const server = createServer((_request: IncomingMessage, response: ServerResponse) => {
        response.writeHead(200, {
            'content-type': 'application/json',
        })
        response.end(JSON.stringify(payload))
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const port = (server.address() as AddressInfo).port
    try {
        return await fn(port)
    } finally {
        await new Promise<void>((resolve, reject) => {
            server.close((error) => (error ? reject(error) : resolve()))
        })
    }
}

describe('runtime health', () => {
    it('requires loopback health to match the expected Pi room identity', async () => {
        await withHealthServer(
            {
                healthy: true,
                roomId: 'room-1',
                runtime: 'pi',
            },
            async (port) => {
                const snapshot = await collectRuntimeHealthSnapshot({
                    roomId: 'room-1',
                    port,
                    pid: process.pid,
                })

                expect(snapshot.healthy).toBe(true)
                expect(snapshot.message).toBe('Room runtime is healthy')
            },
        )
    })

    it('rejects a loopback health response for another room', async () => {
        await withHealthServer(
            {
                healthy: true,
                roomId: 'other-room',
                runtime: 'pi',
            },
            async (port) => {
                const snapshot = await collectRuntimeHealthSnapshot({
                    roomId: 'room-1',
                    port,
                    pid: process.pid,
                })

                expect(snapshot.healthy).toBe(false)
                expect(snapshot.message).toContain('loopbackHealthy=false')
            },
        )
    })
})
