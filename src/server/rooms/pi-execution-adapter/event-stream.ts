import { encodeRoomSseEvent, toRoomRealtimeEvent } from '../execution-adapter'
import type { RoomFileChangedPayload } from '../execution-types'
import {
    openPiRuntimeEventStream,
    openPiRuntimeRoomEventStream,
    publishPiRuntimeRoomFileChanged,
} from '../pi-runtime-client'

const ROOM_STREAM_BACKPRESSURE_LIMIT = -64

export function createRoomSessionEventStream(input: {
    roomId: string
    sessionKey: string
    abortSignal?: AbortSignal
}): ReadableStream<Uint8Array> {
    return createRuntimeEventProxyStream({
        abortSignal: input.abortSignal,
        open: () =>
            openPiRuntimeEventStream({
                roomId: input.roomId,
                sessionKey: input.sessionKey,
                signal: input.abortSignal,
            }),
    })
}

export function createRoomEventStream(input: {
    roomId: string
    abortSignal?: AbortSignal
}): ReadableStream<Uint8Array> {
    return createRuntimeEventProxyStream({
        abortSignal: input.abortSignal,
        open: () =>
            openPiRuntimeRoomEventStream({
                roomId: input.roomId,
                signal: input.abortSignal,
            }),
    })
}

export async function publishRoomFileChanged(input: RoomFileChangedPayload): Promise<void> {
    await publishPiRuntimeRoomFileChanged(input)
}

function createRuntimeEventProxyStream(input: {
    abortSignal?: AbortSignal
    open: () => Promise<ReadableStream<Uint8Array>>
}): ReadableStream<Uint8Array> {
    let closed = false
    let reader: ReadableStreamDefaultReader<Uint8Array> | null = null

    return new ReadableStream<Uint8Array>({
        start(controller) {
            const close = async () => {
                if (closed) {
                    return
                }
                closed = true
                input.abortSignal?.removeEventListener('abort', onAbort)
                if (reader) {
                    await reader.cancel()
                    reader = null
                }
                try {
                    controller.close()
                } catch {}
            }

            const enqueue = (chunk: Uint8Array) => {
                if (closed) {
                    return
                }
                if (
                    typeof controller.desiredSize === 'number' &&
                    controller.desiredSize < ROOM_STREAM_BACKPRESSURE_LIMIT
                ) {
                    controller.enqueue(
                        encodeRoomSseEvent('stream-error', {
                            message: 'Browser stream consumer is too far behind',
                        }),
                    )
                    void close()
                    return
                }
                controller.enqueue(chunk)
            }

            const onAbort = () => {
                void close()
            }

            const run = async () => {
                try {
                    const stream = await input.open()
                    reader = stream.getReader()
                    while (!closed) {
                        const result = await reader.read()
                        if (result.done) {
                            await close()
                            return
                        }
                        enqueue(result.value)
                    }
                } catch (error) {
                    if (!closed) {
                        controller.enqueue(
                            encodeRoomSseEvent(
                                'stream-error',
                                toRoomRealtimeEvent({
                                    event: 'stream-error',
                                    payload: {
                                        message:
                                            error instanceof Error
                                                ? error.message
                                                : 'Room stream failed',
                                    },
                                }),
                            ),
                        )
                        await close()
                    }
                }
            }

            input.abortSignal?.addEventListener('abort', onAbort, { once: true })
            void run()
        },
        cancel() {
            closed = true
            if (reader) {
                void reader.cancel()
                reader = null
            }
        },
    })
}
