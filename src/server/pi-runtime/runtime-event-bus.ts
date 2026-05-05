interface RuntimeEventBusInput {
    roomId: string
    redactPayload: (payload: unknown) => unknown
    stateVersionForThread: (sessionKey: string) => number | null | undefined
}

export interface RuntimeEventBus {
    broadcast: (sessionKey: string, event: string, payload: unknown) => void
    createEventStream: (sessionKey: string) => ReadableStream<Uint8Array>
}

function encodeSse(event: string, payload: unknown): Uint8Array {
    return new TextEncoder().encode(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`)
}

export function createRuntimeEventBus(input: RuntimeEventBusInput): RuntimeEventBus {
    const subscribers = new Map<string, Set<ReadableStreamDefaultController<Uint8Array>>>()
    let eventSeq = 0

    const broadcast = (sessionKey: string, event: string, payload: unknown): void => {
        const targets = subscribers.get(sessionKey)
        if (!targets || targets.size === 0) {
            return
        }
        const redactedPayload = input.redactPayload(payload)
        const frame = encodeSse('room-event', {
            event,
            payload: redactedPayload,
            seq: ++eventSeq,
            stateVersion: input.stateVersionForThread(sessionKey),
            receivedAt: Date.now(),
        })
        for (const controller of targets) {
            try {
                controller.enqueue(frame)
            } catch {
                targets.delete(controller)
            }
        }
    }

    const createEventStream = (sessionKey: string): ReadableStream<Uint8Array> => {
        let controllerRef: ReadableStreamDefaultController<Uint8Array> | null = null
        let timer: ReturnType<typeof setInterval> | null = null

        const removeController = () => {
            if (timer) {
                clearInterval(timer)
                timer = null
            }
            const set = subscribers.get(sessionKey)
            if (!set || !controllerRef) {
                return
            }
            set.delete(controllerRef)
            if (set.size === 0) {
                subscribers.delete(sessionKey)
            }
        }

        return new ReadableStream<Uint8Array>({
            start(controller) {
                controllerRef = controller
                const set = subscribers.get(sessionKey) ?? new Set()
                set.add(controller)
                subscribers.set(sessionKey, set)
                controller.enqueue(
                    encodeSse('ready', {
                        roomId: input.roomId,
                        sessionKey,
                        subscribed: true,
                    }),
                )
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
                }, 15000)
                timer.unref?.()
            },
            cancel() {
                removeController()
            },
        })
    }

    return {
        broadcast,
        createEventStream,
    }
}
