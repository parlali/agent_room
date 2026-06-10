export interface SessionEventQueue<TEvent> {
    enqueue: (event: TEvent) => void
    idle: () => Promise<void>
}

export function createSessionEventQueue<TEvent>(input: {
    handle: (event: TEvent) => Promise<void>
    onError: (error: unknown, event: TEvent) => void
}): SessionEventQueue<TEvent> {
    let pending = Promise.resolve()

    const handleEvent = async (event: TEvent): Promise<void> => {
        try {
            await input.handle(event)
        } catch (error) {
            try {
                input.onError(error, event)
            } catch (handlerError) {
                console.error('Session event error handler failed', handlerError)
            }
        }
    }

    return {
        enqueue(event) {
            pending = pending.then(() => handleEvent(event))
        },
        idle() {
            return pending
        },
    }
}
