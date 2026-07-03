import { describe, expect, it } from 'vitest'

import { createRuntimeEventProxyStream } from './runtime-event-proxy-stream'

const FAST_INTERVALS = {
    heartbeatMs: 10000,
    readyRecheckMinMs: 15,
    readyRecheckMaxMs: 40,
    attachRetryMs: 15,
    sleepCooldownMs: 60000,
}

function encode(text: string): Uint8Array {
    return new TextEncoder().encode(text)
}

function roomEventFrame(event: string, seq: number): Uint8Array {
    return encode(`event: room-event\ndata: ${JSON.stringify({ event, seq })}\n\n`)
}

function streamOf(frames: Uint8Array[], keepOpen: boolean): ReadableStream<Uint8Array> {
    return new ReadableStream<Uint8Array>({
        start(controller) {
            for (const frame of frames) {
                controller.enqueue(frame)
            }
            if (!keepOpen) {
                controller.close()
            }
        },
    })
}

async function readUntil(
    reader: ReadableStreamDefaultReader<Uint8Array>,
    predicate: (text: string) => boolean,
    maxReads = 200,
): Promise<string> {
    const decoder = new TextDecoder()
    for (let attempt = 0; attempt < maxReads; attempt += 1) {
        const result = await reader.read()
        if (result.done) {
            throw new Error('browser stream closed unexpectedly')
        }
        const text = decoder.decode(result.value)
        if (predicate(text)) {
            return text
        }
    }
    throw new Error('predicate not satisfied before maxReads')
}

describe('runtime event proxy stream', () => {
    it('emits an immediate heartbeat comment frame', async () => {
        const stream = createRuntimeEventProxyStream({
            roomId: 'room',
            sessionKey: null,
            streamKind: 'room',
            intervals: FAST_INTERVALS,
            checkReady: async () => false,
            attach: async () => streamOf([], true),
        })
        const reader = stream.getReader()
        const first = new TextDecoder().decode((await reader.read()).value)
        expect(first.startsWith(': heartbeat')).toBe(true)
        await reader.cancel()
    })

    it('holds the connection open while unhealthy and attaches once healthy', async () => {
        let readyCalls = 0
        let attachCalls = 0
        const stream = createRuntimeEventProxyStream({
            roomId: 'room',
            sessionKey: null,
            streamKind: 'room',
            intervals: FAST_INTERVALS,
            checkReady: async () => {
                readyCalls += 1
                return readyCalls >= 3
            },
            attach: async () => {
                attachCalls += 1
                return streamOf([roomEventFrame('run.finished', 7)], true)
            },
        })
        const reader = stream.getReader()
        const frame = await readUntil(reader, (text) => text.includes('event: room-event'))
        expect(frame).toContain('"seq":7')
        expect(attachCalls).toBe(1)
        expect(readyCalls).toBeGreaterThanOrEqual(3)
        await reader.cancel()
    })

    it('emits a runtime-status ready frame when the room stream attaches', async () => {
        let readyCalls = 0
        const stream = createRuntimeEventProxyStream({
            roomId: 'room',
            sessionKey: null,
            streamKind: 'room',
            intervals: FAST_INTERVALS,
            checkReady: async () => {
                readyCalls += 1
                return readyCalls >= 2
            },
            attach: async () => streamOf([], true),
        })
        const reader = stream.getReader()
        const frame = await readUntil(reader, (text) => text.includes('event: runtime-status'))
        expect(frame).toContain('"ready":true')
        await reader.cancel()
    })

    it('emits a runtime-status idle frame when the room stream detaches for sleep', async () => {
        const stream = createRuntimeEventProxyStream({
            roomId: 'room',
            sessionKey: null,
            streamKind: 'room',
            detachAfterIdleMs: 40,
            intervals: FAST_INTERVALS,
            checkReady: async () => true,
            attach: async (signal) =>
                new ReadableStream<Uint8Array>({
                    start(controller) {
                        controller.enqueue(encode('event: heartbeat\ndata: {}\n\n'))
                        signal.addEventListener(
                            'abort',
                            () => {
                                try {
                                    controller.error(new Error('detached'))
                                } catch {}
                            },
                            { once: true },
                        )
                    },
                }),
        })
        const reader = stream.getReader()
        const ready = await readUntil(reader, (text) => text.includes('event: runtime-status'))
        expect(ready).toContain('"ready":true')
        const idle = await readUntil(
            reader,
            (text) => text.includes('event: runtime-status') && text.includes('"ready":false'),
        )
        expect(idle).toContain('"ready":false')
        await reader.cancel()
    })

    it('does not emit runtime-status frames on the session stream', async () => {
        const stream = createRuntimeEventProxyStream({
            roomId: 'room',
            sessionKey: 'session',
            streamKind: 'session',
            intervals: FAST_INTERVALS,
            checkReady: async () => true,
            attach: async () => streamOf([roomEventFrame('run.finished', 3)], true),
        })
        const reader = stream.getReader()
        const decoder = new TextDecoder()
        let seenRoomEvent = false
        let combined = ''
        for (let attempt = 0; attempt < 200 && !seenRoomEvent; attempt += 1) {
            const result = await reader.read()
            if (result.done) {
                break
            }
            const text = decoder.decode(result.value)
            combined += text
            if (text.includes('event: room-event')) {
                seenRoomEvent = true
            }
        }
        expect(seenRoomEvent).toBe(true)
        expect(combined).not.toContain('runtime-status')
        await reader.cancel()
    })

    it('does not close the browser stream when the container stream ends', async () => {
        let attachCalls = 0
        const stream = createRuntimeEventProxyStream({
            roomId: 'room',
            sessionKey: null,
            streamKind: 'room',
            intervals: FAST_INTERVALS,
            checkReady: async () => true,
            attach: async () => {
                attachCalls += 1
                if (attachCalls === 1) {
                    return streamOf([roomEventFrame('run.accepted', 1)], false)
                }
                return streamOf([roomEventFrame('run.finished', 2)], true)
            },
        })
        const reader = stream.getReader()
        const first = await readUntil(reader, (text) => text.includes('"seq":1'))
        expect(first).toContain('event: room-event')
        const second = await readUntil(reader, (text) => text.includes('"seq":2'))
        expect(second).toContain('event: room-event')
        expect(attachCalls).toBeGreaterThanOrEqual(2)
        await reader.cancel()
    })

    it('detaches from the container after the idle window to allow sleep', async () => {
        let attachCalls = 0
        let detachedSignal = false
        const stream = createRuntimeEventProxyStream({
            roomId: 'room',
            sessionKey: null,
            streamKind: 'room',
            detachAfterIdleMs: 40,
            intervals: FAST_INTERVALS,
            checkReady: async () => true,
            attach: async (signal) => {
                attachCalls += 1
                return new ReadableStream<Uint8Array>({
                    start(controller) {
                        controller.enqueue(encode('event: heartbeat\ndata: {}\n\n'))
                        signal.addEventListener(
                            'abort',
                            () => {
                                detachedSignal = true
                                try {
                                    controller.error(new Error('detached'))
                                } catch {}
                            },
                            { once: true },
                        )
                    },
                })
            },
        })
        const reader = stream.getReader()
        await readUntil(reader, (text) => text.includes('event: heartbeat'))
        const deadline = Date.now() + 2000
        while (!detachedSignal && Date.now() < deadline) {
            await new Promise((resolve) => setTimeout(resolve, 10))
        }
        expect(detachedSignal).toBe(true)
        expect(attachCalls).toBe(1)
        await reader.cancel()
    })

    it('keeps re-checking without attaching while the endpoint stays unhealthy', async () => {
        let attachCalls = 0
        let readyCalls = 0
        const stream = createRuntimeEventProxyStream({
            roomId: 'room',
            sessionKey: null,
            streamKind: 'room',
            intervals: FAST_INTERVALS,
            checkReady: async () => {
                readyCalls += 1
                return false
            },
            attach: async () => {
                attachCalls += 1
                return streamOf([], true)
            },
        })
        const reader = stream.getReader()
        await new Promise((resolve) => setTimeout(resolve, 120))
        expect(attachCalls).toBe(0)
        expect(readyCalls).toBeGreaterThan(1)
        await reader.cancel()
    })
})
