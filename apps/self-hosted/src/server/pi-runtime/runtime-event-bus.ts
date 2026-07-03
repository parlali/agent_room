import { runtimeBroadcastPayload } from './runtime-event-payload'

interface RuntimeEventBusInput {
    roomId: string
    redactPayload: (payload: unknown) => unknown
    stateVersionForThread: (sessionKey: string) => number | null | undefined
}

export interface RuntimeEventBus {
    broadcast: (sessionKey: string, event: string, payload: unknown) => void
    createEventStream: (sessionKey: string) => ReadableStream<Uint8Array>
    createRoomEventStream: () => ReadableStream<Uint8Array>
}

export const RUNTIME_EVENT_STREAM_HEARTBEAT_MS = 5000
export const RUNTIME_EVENT_REPLAY_BUFFER_LIMIT = 256

interface BufferedRuntimeEvent {
    sessionKey: string
    seq: number
    frame: Uint8Array
}

function encodeSse(event: string, payload: unknown): Uint8Array {
    return new TextEncoder().encode(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`)
}

export function createRuntimeEventBus(input: RuntimeEventBusInput): RuntimeEventBus {
    const subscribers = new Map<string, Set<ReadableStreamDefaultController<Uint8Array>>>()
    const roomSubscribers = new Set<ReadableStreamDefaultController<Uint8Array>>()
    const replayBuffer: BufferedRuntimeEvent[] = []
    let eventSeq = 0

    const recordReplay = (entry: BufferedRuntimeEvent): void => {
        replayBuffer.push(entry)
        if (replayBuffer.length > RUNTIME_EVENT_REPLAY_BUFFER_LIMIT) {
            replayBuffer.splice(0, replayBuffer.length - RUNTIME_EVENT_REPLAY_BUFFER_LIMIT)
        }
    }

    const enqueueAll = (
        targets: Set<ReadableStreamDefaultController<Uint8Array>>,
        frame: Uint8Array,
    ): void => {
        for (const controller of targets) {
            try {
                controller.enqueue(frame)
            } catch {
                targets.delete(controller)
            }
        }
    }

    const broadcast = (sessionKey: string, event: string, payload: unknown): void => {
        const redactedPayload = input.redactPayload(runtimeBroadcastPayload(event, payload))
        const seq = ++eventSeq
        const frame = encodeSse('room-event', {
            event,
            payload: redactedPayload,
            seq,
            stateVersion: input.stateVersionForThread(sessionKey),
            receivedAt: Date.now(),
        })
        recordReplay({ sessionKey, seq, frame })
        const sessionTargets = subscribers.get(sessionKey)
        if (sessionTargets) {
            enqueueAll(sessionTargets, frame)
        }
        enqueueAll(roomSubscribers, frame)
    }

    const createStream = (inputStream: {
        readyPayload: unknown
        replayFrames: () => Uint8Array[]
        add: (controller: ReadableStreamDefaultController<Uint8Array>) => void
        remove: (controller: ReadableStreamDefaultController<Uint8Array>) => void
    }): ReadableStream<Uint8Array> => {
        let controllerRef: ReadableStreamDefaultController<Uint8Array> | null = null
        let timer: ReturnType<typeof setInterval> | null = null

        const removeController = () => {
            if (timer) {
                clearInterval(timer)
                timer = null
            }
            if (controllerRef) {
                inputStream.remove(controllerRef)
            }
        }

        return new ReadableStream<Uint8Array>({
            start(controller) {
                controllerRef = controller
                inputStream.add(controller)
                controller.enqueue(encodeSse('ready', inputStream.readyPayload))
                for (const frame of inputStream.replayFrames()) {
                    controller.enqueue(frame)
                }
                timer = setInterval(() => {
                    try {
                        controller.enqueue(
                            encodeSse('heartbeat', {
                                ts: Date.now(),
                            }),
                        )
                    } catch {
                        removeController()
                    }
                }, RUNTIME_EVENT_STREAM_HEARTBEAT_MS)
                timer.unref?.()
            },
            cancel() {
                removeController()
            },
        })
    }

    const createRoomEventStream = (): ReadableStream<Uint8Array> =>
        createStream({
            readyPayload: {
                roomId: input.roomId,
                subscribed: true,
            },
            replayFrames: () => replayBuffer.map((entry) => entry.frame),
            add: (controller) => {
                roomSubscribers.add(controller)
            },
            remove: (controller) => {
                roomSubscribers.delete(controller)
            },
        })

    const createEventStream = (sessionKey: string): ReadableStream<Uint8Array> =>
        createStream({
            readyPayload: {
                roomId: input.roomId,
                sessionKey,
                subscribed: true,
            },
            replayFrames: () =>
                replayBuffer
                    .filter((entry) => entry.sessionKey === sessionKey)
                    .map((entry) => entry.frame),
            add: (controller) => {
                const set = subscribers.get(sessionKey) ?? new Set()
                set.add(controller)
                subscribers.set(sessionKey, set)
            },
            remove: (controller) => {
                const set = subscribers.get(sessionKey)
                if (!set) {
                    return
                }
                set.delete(controller)
                if (set.size === 0) {
                    subscribers.delete(sessionKey)
                }
            },
        })

    return {
        broadcast,
        createEventStream,
        createRoomEventStream,
    }
}
