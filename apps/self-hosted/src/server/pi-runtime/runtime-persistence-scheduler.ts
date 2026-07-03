export interface DebouncedPersister {
    schedule: () => void
    flush: () => Promise<void>
    shutdown: () => Promise<void>
}

export function createDebouncedPersister(input: {
    intervalMs: number
    persist: () => Promise<void>
    onError: (error: unknown) => void
}): DebouncedPersister {
    let tail: Promise<void> = Promise.resolve()
    let timer: ReturnType<typeof setTimeout> | null = null
    let dirty = false
    let closed = false

    function clearTimer(): void {
        if (timer) {
            clearTimeout(timer)
            timer = null
        }
    }

    function enqueuePersist(): Promise<void> {
        dirty = false
        const run = tail.then(() => input.persist())
        tail = run.catch(() => undefined)
        return run
    }

    return {
        schedule() {
            if (closed) {
                return
            }
            dirty = true
            if (timer) {
                return
            }
            timer = setTimeout(() => {
                timer = null
                if (!dirty) {
                    return
                }
                enqueuePersist().catch((error) => {
                    input.onError(error)
                })
            }, input.intervalMs)
            timer.unref()
        },
        flush() {
            clearTimer()
            return enqueuePersist()
        },
        async shutdown() {
            closed = true
            clearTimer()
            try {
                await enqueuePersist()
            } catch (error) {
                input.onError(error)
            }
        },
    }
}
