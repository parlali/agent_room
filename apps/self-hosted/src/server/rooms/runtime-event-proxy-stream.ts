import { encodeRoomSseEvent } from './execution-adapter'
import { cancelReadableStreamReaderInBackground } from '../streams/readable-stream'
import { elapsedPerformanceMs, logPerformanceEvent, performanceNow } from '../telemetry/performance'

const ROOM_STREAM_BACKPRESSURE_LIMIT = -64
const ROOM_EVENT_FRAME_MARKER = 'event: room-event'

const DEFAULT_INTERVALS = {
    heartbeatMs: 20000,
    readyRecheckMinMs: 2500,
    readyRecheckMaxMs: 15000,
    attachRetryMs: 1500,
    sleepCooldownMs: 15 * 60 * 1000,
}

export interface RuntimeEventProxyIntervals {
    heartbeatMs?: number
    readyRecheckMinMs?: number
    readyRecheckMaxMs?: number
    attachRetryMs?: number
    sleepCooldownMs?: number
}

function heartbeatFrame(): Uint8Array {
    return new TextEncoder().encode(`: heartbeat ${Date.now()}\n\n`)
}

function chunkCarriesRunEvent(chunk: Uint8Array): boolean {
    try {
        return new TextDecoder('utf-8', { fatal: false })
            .decode(chunk)
            .includes(ROOM_EVENT_FRAME_MARKER)
    } catch {
        return true
    }
}

export function createRuntimeEventProxyStream(input: {
    roomId: string
    sessionKey: string | null
    streamKind: 'session' | 'room'
    abortSignal?: AbortSignal
    attach: (signal: AbortSignal) => Promise<ReadableStream<Uint8Array>>
    checkReady?: () => Promise<boolean>
    detachAfterIdleMs?: number | null
    intervals?: RuntimeEventProxyIntervals
}): ReadableStream<Uint8Array> {
    const heartbeatMs = input.intervals?.heartbeatMs ?? DEFAULT_INTERVALS.heartbeatMs
    const readyRecheckMinMs =
        input.intervals?.readyRecheckMinMs ?? DEFAULT_INTERVALS.readyRecheckMinMs
    const readyRecheckMaxMs =
        input.intervals?.readyRecheckMaxMs ?? DEFAULT_INTERVALS.readyRecheckMaxMs
    const attachRetryMs = input.intervals?.attachRetryMs ?? DEFAULT_INTERVALS.attachRetryMs
    const sleepCooldownMs = input.intervals?.sleepCooldownMs ?? DEFAULT_INTERVALS.sleepCooldownMs
    let closed = false
    let closeLogged = false
    let firstChunkLogged = false
    let chunks = 0
    let bytes = 0
    let attachCount = 0
    const startedAt = performanceNow()
    let stop: ((reason: string) => void) | null = null

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
            attachCount,
            chunks,
            bytes,
        })
    }

    const logCancelError = (error: unknown) => {
        logPerformanceEvent('sse.runtime_proxy.cancel_error', {
            roomId: input.roomId,
            sessionKey: input.sessionKey,
            streamKind: input.streamKind,
            durationMs: elapsedPerformanceMs(startedAt),
            chunks,
            bytes,
            errorName: error instanceof Error ? error.name : typeof error,
        })
    }

    const logTransition = (transition: string, detail: Record<string, unknown>) => {
        logPerformanceEvent('sse.runtime_proxy.transition', {
            roomId: input.roomId,
            sessionKey: input.sessionKey,
            streamKind: input.streamKind,
            transition,
            durationMs: elapsedPerformanceMs(startedAt),
            attachCount,
            ...detail,
        })
    }

    return new ReadableStream<Uint8Array>({
        start(controller) {
            let wakeDelay: (() => void) | null = null
            let heartbeatTimer: ReturnType<typeof setInterval> | null = null
            let activeAttachController: AbortController | null = null

            const safeEnqueue = (frame: Uint8Array): void => {
                if (closed) {
                    return
                }
                try {
                    controller.enqueue(frame)
                } catch {}
            }

            const emitRuntimeStatus = (ready: boolean): void => {
                if (input.streamKind !== 'room') {
                    return
                }
                safeEnqueue(
                    encodeRoomSseEvent('runtime-status', {
                        roomId: input.roomId,
                        ready,
                    }),
                )
            }

            const enqueueUpstream = (chunk: Uint8Array): void => {
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
                    close('backpressure')
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
                        chunkBytes: chunk.byteLength,
                    })
                }
                controller.enqueue(chunk)
            }

            const close = (reason: string) => {
                if (closed) {
                    return
                }
                closed = true
                input.abortSignal?.removeEventListener('abort', onAbort)
                if (heartbeatTimer) {
                    clearInterval(heartbeatTimer)
                    heartbeatTimer = null
                }
                if (activeAttachController) {
                    try {
                        activeAttachController.abort()
                    } catch {}
                    activeAttachController = null
                }
                if (wakeDelay) {
                    wakeDelay()
                    wakeDelay = null
                }
                try {
                    controller.close()
                } catch {}
                logClose(reason)
            }
            stop = close

            const onAbort = () => close('aborted')

            const delay = (ms: number): Promise<void> =>
                new Promise((resolve) => {
                    if (closed) {
                        resolve()
                        return
                    }
                    const timer = setTimeout(() => {
                        wakeDelay = null
                        resolve()
                    }, ms)
                    if (typeof timer === 'object' && timer !== null) {
                        ;(timer as { unref?: () => void }).unref?.()
                    }
                    wakeDelay = () => {
                        clearTimeout(timer)
                        resolve()
                    }
                })

            const pumpUpstream = async (
                reader: ReadableStreamDefaultReader<Uint8Array>,
                attachController: AbortController,
            ): Promise<'upstream_done' | 'upstream_error' | 'idle_detach' | 'closed'> => {
                let lastRunEventAt = Date.now()
                let idleDetach = false
                let idleTimer: ReturnType<typeof setInterval> | null = null
                const detachAfterIdleMs = input.detachAfterIdleMs
                if (typeof detachAfterIdleMs === 'number' && detachAfterIdleMs > 0) {
                    idleTimer = setInterval(
                        () => {
                            if (Date.now() - lastRunEventAt >= detachAfterIdleMs) {
                                idleDetach = true
                                try {
                                    attachController.abort()
                                } catch {}
                            }
                        },
                        Math.min(detachAfterIdleMs, 10000),
                    )
                    idleTimer.unref?.()
                }
                try {
                    while (!closed) {
                        const result = await reader.read()
                        if (result.done) {
                            return 'upstream_done'
                        }
                        if (chunkCarriesRunEvent(result.value)) {
                            lastRunEventAt = Date.now()
                        }
                        enqueueUpstream(result.value)
                    }
                    return 'closed'
                } catch (error) {
                    if (idleDetach) {
                        return 'idle_detach'
                    }
                    if (closed) {
                        return 'closed'
                    }
                    logTransition('upstream_error', {
                        errorName: error instanceof Error ? error.name : typeof error,
                    })
                    return 'upstream_error'
                } finally {
                    if (idleTimer) {
                        clearInterval(idleTimer)
                    }
                }
            }

            const run = async () => {
                let wasReady = false
                let sleepCooldownUntil: number | null = null
                let recheckMs = readyRecheckMinMs

                while (!closed) {
                    let ready: boolean
                    if (input.checkReady) {
                        try {
                            ready = await input.checkReady()
                        } catch (error) {
                            ready = false
                            logTransition('ready_check_error', {
                                errorName: error instanceof Error ? error.name : typeof error,
                            })
                        }
                    } else {
                        ready = true
                    }
                    if (closed) {
                        return
                    }

                    if (!ready) {
                        sleepCooldownUntil = null
                        wasReady = false
                        recheckMs = Math.min(readyRecheckMaxMs, Math.round(recheckMs * 1.5))
                        await delay(recheckMs)
                        continue
                    }

                    const transitionedUp = !wasReady
                    wasReady = true
                    const inCooldown =
                        sleepCooldownUntil !== null && Date.now() < sleepCooldownUntil
                    if (inCooldown && !transitionedUp) {
                        await delay(readyRecheckMinMs)
                        continue
                    }
                    sleepCooldownUntil = null
                    recheckMs = readyRecheckMinMs

                    const attachController = new AbortController()
                    activeAttachController = attachController
                    let upstream: ReadableStream<Uint8Array>
                    try {
                        upstream = await input.attach(attachController.signal)
                    } catch (error) {
                        activeAttachController = null
                        logTransition('attach_failed', {
                            errorName: error instanceof Error ? error.name : typeof error,
                        })
                        if (closed) {
                            return
                        }
                        wasReady = false
                        await delay(attachRetryMs)
                        continue
                    }
                    if (closed) {
                        cancelReadableStreamReaderInBackground(upstream.getReader(), logCancelError)
                        return
                    }
                    attachCount += 1
                    logTransition('attached', {})
                    emitRuntimeStatus(true)
                    const reader = upstream.getReader()
                    const outcome = await pumpUpstream(reader, attachController)
                    activeAttachController = null
                    cancelReadableStreamReaderInBackground(reader, logCancelError)
                    if (closed) {
                        return
                    }
                    if (outcome === 'idle_detach') {
                        sleepCooldownUntil = Date.now() + sleepCooldownMs
                        wasReady = true
                        logTransition('idle_detach', {})
                        emitRuntimeStatus(false)
                        await delay(readyRecheckMinMs)
                        continue
                    }
                    logTransition('detached', { outcome })
                    wasReady = false
                    await delay(attachRetryMs)
                }
            }

            input.abortSignal?.addEventListener('abort', onAbort, { once: true })
            heartbeatTimer = setInterval(() => {
                safeEnqueue(heartbeatFrame())
            }, heartbeatMs)
            heartbeatTimer.unref?.()
            safeEnqueue(heartbeatFrame())
            run()
                .then(() => {
                    logTransition('run_loop_exit', { closed })
                    if (!closed) {
                        close('run_loop_exited_unexpectedly')
                    }
                })
                .catch((error) => {
                    logTransition('run_loop_crashed', {
                        errorName: error instanceof Error ? error.name : typeof error,
                    })
                    close('run_loop_crashed')
                })
        },
        cancel() {
            if (stop) {
                stop('consumer_cancelled')
            } else {
                closed = true
                logClose('consumer_cancelled')
            }
        },
    })
}
