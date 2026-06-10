import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
    openPiRuntimeEventStream: vi.fn(),
    openPiRuntimeRoomEventStream: vi.fn(),
    publishPiRuntimeRoomFileChanged: vi.fn(),
}))

vi.mock('../pi-runtime-client', () => ({
    openPiRuntimeEventStream: mocks.openPiRuntimeEventStream,
    openPiRuntimeRoomEventStream: mocks.openPiRuntimeRoomEventStream,
    publishPiRuntimeRoomFileChanged: mocks.publishPiRuntimeRoomFileChanged,
}))

function rejectingRuntimeStream(error: Error): ReadableStream<Uint8Array> {
    return new ReadableStream<Uint8Array>({
        pull() {
            return Promise.reject(error)
        },
    })
}

async function readWithTimeout(
    reader: ReadableStreamDefaultReader<Uint8Array>,
): Promise<ReadableStreamReadResult<Uint8Array>> {
    return Promise.race([
        reader.read(),
        new Promise<never>((_resolve, reject) => {
            setTimeout(() => reject(new Error('timed out waiting for stream read')), 250)
        }),
    ])
}

describe('Pi runtime event stream proxy', () => {
    beforeEach(() => {
        vi.resetModules()
        mocks.openPiRuntimeEventStream.mockReset()
        mocks.openPiRuntimeRoomEventStream.mockReset()
        mocks.publishPiRuntimeRoomFileChanged.mockReset()
    })

    it('closes the browser stream when the upstream runtime stream errors during cleanup', async () => {
        const upstreamError = new Error('runtime socket closed')
        mocks.openPiRuntimeRoomEventStream.mockResolvedValue(rejectingRuntimeStream(upstreamError))
        const { createRoomEventStream } = await import('./event-stream')

        const reader = createRoomEventStream({ roomId: 'room-1' }).getReader()
        const first = await readWithTimeout(reader)
        expect(first.done).toBe(false)
        expect(new TextDecoder().decode(first.value)).toContain('runtime socket closed')

        await expect(readWithTimeout(reader)).resolves.toEqual({
            done: true,
            value: undefined,
        })
        expect(mocks.openPiRuntimeRoomEventStream).toHaveBeenCalledWith({
            roomId: 'room-1',
            signal: undefined,
        })
    })

    it('does not leak cancellation failures when the browser closes the stream', async () => {
        const chunk = new TextEncoder().encode('data: ready\n\n')
        const runtimeStream = new ReadableStream<Uint8Array>({
            start(controller) {
                controller.enqueue(chunk)
            },
            cancel() {
                return Promise.reject(new Error('runtime cancel failed'))
            },
        })
        mocks.openPiRuntimeRoomEventStream.mockResolvedValue(runtimeStream)
        const { createRoomEventStream } = await import('./event-stream')

        const reader = createRoomEventStream({ roomId: 'room-1' }).getReader()
        await expect(readWithTimeout(reader)).resolves.toEqual({
            done: false,
            value: chunk,
        })
        await expect(reader.cancel()).resolves.toBeUndefined()
        await new Promise((resolve) => setTimeout(resolve, 0))
    })
})
