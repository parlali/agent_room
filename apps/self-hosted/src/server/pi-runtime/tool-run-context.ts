import { AsyncLocalStorage } from 'node:async_hooks'

export interface ToolRunContext {
    sessionKey: string
    runId: string
    jobId?: string | null
    signal: AbortSignal
}

const storage = new AsyncLocalStorage<ToolRunContext>()

export function withToolRunContext<T>(context: ToolRunContext, run: () => Promise<T>): Promise<T> {
    return storage.run(context, run)
}

export function currentToolRunSignal(): AbortSignal | null {
    return storage.getStore()?.signal ?? null
}

export function currentToolRunContext(): ToolRunContext | null {
    return storage.getStore() ?? null
}

export function combineAbortSignals(signals: Array<AbortSignal | null | undefined>): {
    signal?: AbortSignal
    dispose: () => void
} {
    const liveSignals = Array.from(
        new Set(signals.filter((signal) => signal !== null && signal !== undefined)),
    )
    if (liveSignals.length === 0) {
        return {
            signal: undefined,
            dispose: () => {},
        }
    }
    if (liveSignals.length === 1) {
        return {
            signal: liveSignals[0],
            dispose: () => {},
        }
    }

    const controller = new AbortController()
    const abort = () => {
        controller.abort()
    }

    for (const signal of liveSignals) {
        if (signal.aborted) {
            abort()
            break
        }
        signal.addEventListener('abort', abort, {
            once: true,
        })
    }

    return {
        signal: controller.signal,
        dispose: () => {
            for (const signal of liveSignals) {
                signal.removeEventListener('abort', abort)
            }
        },
    }
}
