import { afterEach, describe, expect, it, vi } from 'vitest'
import { RUNTIME_EVENT_STREAM_HEARTBEAT_MS, createRuntimeEventBus } from './runtime-event-bus'

async function readSse(reader: ReadableStreamDefaultReader<Uint8Array>) {
    const result = await reader.read()
    if (result.done) {
        throw new Error('Expected an SSE frame')
    }
    const text = new TextDecoder().decode(result.value)
    const event = text.match(/^event: (.+)$/m)?.[1] ?? null
    const data = text.match(/^data: (.+)$/m)?.[1] ?? null
    return {
        event,
        data: data ? JSON.parse(data) : null,
    }
}

describe('runtime event bus', () => {
    afterEach(() => {
        vi.useRealTimers()
    })

    it('broadcasts thread events to room subscribers without losing session streams', async () => {
        const bus = createRuntimeEventBus({
            roomId: 'room-1',
            redactPayload: (payload) => payload,
            stateVersionForThread: (sessionKey) => (sessionKey === 'thread-1' ? 10 : null),
        })
        const roomReader = bus.createRoomEventStream().getReader()
        const sessionReader = bus.createEventStream('thread-1').getReader()

        await readSse(roomReader)
        await readSse(sessionReader)

        bus.broadcast('thread-2', 'room.files.changed', {
            relativePath: 'created.txt',
        })
        const roomFrame = await readSse(roomReader)
        expect(roomFrame).toMatchObject({
            event: 'room-event',
            data: {
                event: 'room.files.changed',
                payload: {
                    relativePath: 'created.txt',
                },
                stateVersion: null,
            },
        })

        bus.broadcast('thread-1', 'agent_end', {
            sessionKey: 'thread-1',
        })
        const sessionFrame = await readSse(sessionReader)
        expect(sessionFrame).toMatchObject({
            event: 'room-event',
            data: {
                event: 'agent_end',
                payload: {
                    sessionKey: 'thread-1',
                },
                stateVersion: 10,
            },
        })

        await roomReader.cancel()
        await sessionReader.cancel()
    })

    it('keeps idle streams warm before production proxy idle cutoffs', async () => {
        vi.useFakeTimers()
        const bus = createRuntimeEventBus({
            roomId: 'room-1',
            redactPayload: (payload) => payload,
            stateVersionForThread: () => null,
        })
        const reader = bus.createRoomEventStream().getReader()

        await readSse(reader)
        const heartbeat = readSse(reader)
        vi.advanceTimersByTime(RUNTIME_EVENT_STREAM_HEARTBEAT_MS)

        await expect(heartbeat).resolves.toMatchObject({
            event: 'heartbeat',
        })

        await reader.cancel()
    })
})
