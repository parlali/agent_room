import { describe, expect, it } from 'vitest'

import {
    createRuntimeEventBus,
    RUNTIME_EVENT_REPLAY_BUFFER_LIMIT,
    type RuntimeEventBus,
} from './runtime-event-bus'

interface DecodedFrame {
    event: string
    data: unknown
}

function makeBus(): RuntimeEventBus {
    return createRuntimeEventBus({
        roomId: 'room-test',
        redactPayload: (payload) => payload,
        stateVersionForThread: () => null,
    })
}

async function collectFrames(
    stream: ReadableStream<Uint8Array>,
    count: number,
): Promise<DecodedFrame[]> {
    const reader = stream.getReader()
    const decoder = new TextDecoder()
    const frames: DecodedFrame[] = []
    try {
        while (frames.length < count) {
            const result = await reader.read()
            if (result.done) {
                break
            }
            const text = decoder.decode(result.value)
            for (const block of text.split('\n\n')) {
                if (!block.trim()) {
                    continue
                }
                const eventMatch = block.match(/event: (.*)/)
                const dataMatch = block.match(/data: (.*)/)
                if (!eventMatch) {
                    continue
                }
                frames.push({
                    event: eventMatch[1]!.trim(),
                    data: dataMatch ? JSON.parse(dataMatch[1]!) : null,
                })
            }
        }
    } finally {
        await reader.cancel()
    }
    return frames
}

function roomEventFrames(frames: DecodedFrame[]): Array<{ event: string; seq: number }> {
    return frames
        .filter((frame) => frame.event === 'room-event')
        .map((frame) => frame.data as { event: string; seq: number })
}

describe('runtime event bus replay', () => {
    it('replays buffered events to a late room subscriber with monotonic seq', async () => {
        const bus = makeBus()
        bus.broadcast('session-a', 'run.accepted', { sessionKey: 'session-a', value: 1 })
        bus.broadcast('session-a', 'message_update', { sessionKey: 'session-a', value: 2 })
        bus.broadcast('session-a', 'run.finished', { sessionKey: 'session-a', value: 3 })

        const frames = await collectFrames(bus.createRoomEventStream(), 4)
        expect(frames[0]?.event).toBe('ready')
        const events = roomEventFrames(frames)
        expect(events.map((event) => event.event)).toEqual([
            'run.accepted',
            'message_update',
            'run.finished',
        ])
        expect(events.map((event) => event.seq)).toEqual([1, 2, 3])
    })

    it('only replays matching session events to a session subscriber', async () => {
        const bus = makeBus()
        bus.broadcast('session-a', 'message_update', { sessionKey: 'session-a' })
        bus.broadcast('session-b', 'message_update', { sessionKey: 'session-b' })
        bus.broadcast('session-a', 'run.finished', { sessionKey: 'session-a' })

        const frames = await collectFrames(bus.createEventStream('session-a'), 3)
        const events = roomEventFrames(frames)
        expect(events.map((event) => event.seq)).toEqual([1, 3])
    })

    it('bounds the replay buffer and keeps the most recent events', async () => {
        const bus = makeBus()
        const total = RUNTIME_EVENT_REPLAY_BUFFER_LIMIT + 44
        for (let index = 0; index < total; index += 1) {
            bus.broadcast('session-a', 'message_update', { sessionKey: 'session-a', index })
        }

        const frames = await collectFrames(
            bus.createRoomEventStream(),
            RUNTIME_EVENT_REPLAY_BUFFER_LIMIT + 1,
        )
        const events = roomEventFrames(frames)
        expect(events.length).toBe(RUNTIME_EVENT_REPLAY_BUFFER_LIMIT)
        expect(events[0]?.seq).toBe(total - RUNTIME_EVENT_REPLAY_BUFFER_LIMIT + 1)
        expect(events[events.length - 1]?.seq).toBe(total)
        for (let index = 1; index < events.length; index += 1) {
            expect(events[index]!.seq).toBeGreaterThan(events[index - 1]!.seq)
        }
    })

    it('delivers live events to an attached subscriber after replay', async () => {
        const bus = makeBus()
        bus.broadcast('session-a', 'run.accepted', { sessionKey: 'session-a' })
        const stream = bus.createRoomEventStream()
        const reader = stream.getReader()
        const decoder = new TextDecoder()

        const readRoomEvent = async (): Promise<{ event: string; seq: number } | null> => {
            for (let attempt = 0; attempt < 10; attempt += 1) {
                const result = await reader.read()
                if (result.done) {
                    return null
                }
                const text = decoder.decode(result.value)
                const block = text
                    .split('\n\n')
                    .find((entry) => entry.includes('event: room-event'))
                if (!block) {
                    continue
                }
                const dataMatch = block.match(/data: (.*)/)
                return dataMatch ? JSON.parse(dataMatch[1]!) : null
            }
            return null
        }

        const replayed = await readRoomEvent()
        expect(replayed?.event).toBe('run.accepted')
        expect(replayed?.seq).toBe(1)

        bus.broadcast('session-a', 'run.finished', { sessionKey: 'session-a' })
        const live = await readRoomEvent()
        expect(live?.event).toBe('run.finished')
        expect(live?.seq).toBe(2)
        await reader.cancel()
    })
})
