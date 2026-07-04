import { describe, expect, it, vi } from 'vitest'

import { createRoomEventStream, createRoomSessionEventStream } from './execution-engine'

const hostedCreateRoomEventStream = vi.fn()
const hostedCreateRoomSessionEventStream = vi.fn()
const localCreateRoomEventStream = vi.fn()
const localCreateRoomSessionEventStream = vi.fn()

vi.mock('../cloudflare/hosted-execution-adapter', () => ({
    createRoomEventStream: hostedCreateRoomEventStream,
    createRoomSessionEventStream: hostedCreateRoomSessionEventStream,
}))

vi.mock('./pi-execution-adapter', () => ({
    createRoomEventStream: localCreateRoomEventStream,
    createRoomSessionEventStream: localCreateRoomSessionEventStream,
}))

function heartbeatOnlyStream(): ReadableStream<Uint8Array> {
    return new ReadableStream<Uint8Array>({
        start(controller) {
            controller.enqueue(new TextEncoder().encode(`: heartbeat ${Date.now()}\n\n`))
        },
    })
}

async function firstFrame(stream: ReadableStream<Uint8Array>): Promise<string> {
    const reader = stream.getReader()
    const result = await reader.read()
    await reader.cancel()
    return new TextDecoder().decode(result.value)
}

describe('execution-engine event streams select the adapter from the explicit context', () => {
    it('uses the hosted adapter with the passed context and never the local adapter', async () => {
        hostedCreateRoomEventStream.mockReturnValue(heartbeatOnlyStream())
        const context = { env: {} as never, workspaceId: 'workspace-1' }
        const stream = createRoomEventStream({
            roomId: 'room-1',
            hosted: context,
        })
        const frame = await firstFrame(stream)
        expect(frame.startsWith(': heartbeat')).toBe(true)
        expect(hostedCreateRoomEventStream).toHaveBeenCalledWith({
            roomId: 'room-1',
            abortSignal: undefined,
            context,
        })
        expect(localCreateRoomEventStream).not.toHaveBeenCalled()
    })

    it('uses the local adapter only when no hosted context is provided', async () => {
        localCreateRoomSessionEventStream.mockReturnValue(heartbeatOnlyStream())
        const stream = createRoomSessionEventStream({
            roomId: 'room-1',
            sessionKey: 'session-1',
            hosted: null,
        })
        const frame = await firstFrame(stream)
        expect(frame.startsWith(': heartbeat')).toBe(true)
        expect(localCreateRoomSessionEventStream).toHaveBeenCalledWith({
            roomId: 'room-1',
            sessionKey: 'session-1',
            abortSignal: undefined,
        })
        expect(hostedCreateRoomSessionEventStream).not.toHaveBeenCalled()
    })
})
