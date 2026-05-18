let preloadPromise: Promise<unknown> | null = null

export function preloadRoomDashboardRoutes(): Promise<unknown> {
    preloadPromise ??= import('#/routeTree.gen')
    return preloadPromise
}

export function scheduleRoomDashboardRoutePreload(timeoutMs = 1200): () => void {
    let cancelled = false
    const run = () => {
        if (cancelled) return
        void preloadRoomDashboardRoutes()
    }
    const idleWindow = window as Window & {
        requestIdleCallback?: Window['requestIdleCallback']
        cancelIdleCallback?: Window['cancelIdleCallback']
    }
    if (typeof idleWindow.requestIdleCallback === 'function') {
        const idleId = idleWindow.requestIdleCallback(run, { timeout: timeoutMs })
        return () => {
            cancelled = true
            idleWindow.cancelIdleCallback?.(idleId)
        }
    }

    const timeout = window.setTimeout(run, timeoutMs)
    return () => {
        cancelled = true
        window.clearTimeout(timeout)
    }
}
