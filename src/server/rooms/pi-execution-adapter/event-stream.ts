import { encodeRoomSseEvent, toRoomRealtimeEvent } from '../execution-adapter'
import type { RoomFileChangedPayload } from '../execution-types'
import {
    openPiRuntimeEventStream,
    openPiRuntimeRoomEventStream,
    publishPiRuntimeRoomFileChanged,
} from '../pi-runtime-client'
import {
    elapsedPerformanceMs,
    logPerformanceEvent,
    performanceNow,
} from '../../telemetry/performance'

const ROOM_STREAM_BACKPRESSURE_LIMIT = -64

export function createRoomSessionEventStream(input: {
    roomId: string
    sessionKey: string
    abortSignal?: AbortSignal
}): ReadableStream<Uint8Array> {
    return createRuntimeEventProxyStream({
        roomId: input.roomId,
        sessionKey: input.sessionKey,
        streamKind: 'session',
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
        roomId: input.roomId,
        sessionKey: null,
        streamKind: 'room',
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
    roomId: string
    sessionKey: string | null
    streamKind: 'session' | 'room'
    abortSignal?: AbortSignal
    open: () => Promise<ReadableStream<Uint8Array>>
}): ReadableStream<Uint8Array> {
    let closed = false
    let closeLogged = false
    let firstChunkLogged = false
    let chunks = 0
    let bytes = 0
    let openMs: number | null = null
    let reader: ReadableStreamDefaultReader<Uint8Array> | null = null
    const startedAt = performanceNow()

    const logClose = (reason: string) => {
        if (closeLogged) {
            return
        }
        closeLogged = true
        logPerformanceEvent('sse.runtime_proxy.closed', {
            roomId: input.roomId,
            sessionKey: input.sessionKey,
            streamKind: input.streamKind,
            reason,
            durationMs: elapsedPerformanceMs(startedAt),
            openMs,
            chunks,
            bytes,
        })
    }

    return new ReadableStream<Uint8Array>({
        start(controller) {
            const close = async (reason: string) => {
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
                logClose(reason)
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
                    logPerformanceEvent('sse.runtime_proxy.backpressure', {
                        roomId: input.roomId,
                        sessionKey: input.sessionKey,
                        streamKind: input.streamKind,
                        durationMs: elapsedPerformanceMs(startedAt),
                        chunks,
                        bytes,
                    })
                    void close('backpressure')
                    return
                }
                chunks += 1
                bytes += chunk.byteLength
                if (!firstChunkLogged) {
                    firstChunkLogged = true
                    logPerformanceEvent('sse.runtime_proxy.first_chunk', {
                        roomId: input.roomId,
                        sessionKey: input.sessionKey,
                        streamKind: input.streamKind,
                        durationMs: elapsedPerformanceMs(startedAt),
                        openMs,
                        chunkBytes: chunk.byteLength,
                    })
                }
                controller.enqueue(chunk)
            }

            const onAbort = () => {
                void close('aborted')
            }

            const run = async () => {
                try {
                    const openStartedAt = performanceNow()
                    const stream = await input.open()
                    openMs = elapsedPerformanceMs(openStartedAt)
                    logPerformanceEvent('sse.runtime_proxy.open', {
                        roomId: input.roomId,
                        sessionKey: input.sessionKey,
                        streamKind: input.streamKind,
                        durationMs: elapsedPerformanceMs(startedAt),
                        openMs,
                    })
                    reader = stream.getReader()
                    while (!closed) {
                        const result = await reader.read()
                        if (result.done) {
                            await close('upstream_done')
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
                        logPerformanceEvent('sse.runtime_proxy.error', {
                            roomId: input.roomId,
                            sessionKey: input.sessionKey,
                            streamKind: input.streamKind,
                            durationMs: elapsedPerformanceMs(startedAt),
                            openMs,
                            chunks,
                            bytes,
                            errorName: error instanceof Error ? error.name : typeof error,
                        })
                        await close('error')
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
            logClose('consumer_cancelled')
        },
    })
}
