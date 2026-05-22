import { recordClientPerformanceServer } from '#/routes/-room-runtime-server'

export type ClientPerformanceEventName =
    | 'navigation.paint'
    | 'route.remount'
    | 'document.navigation'
    | 'long.main_thread_task'
    | 'chat.selection.shell_paint'
    | 'chat.selection.latest_message_paint'
    | 'chat.markdown.render'
    | 'chat.window.render'
    | 'artifact.panel.mount'
    | 'artifact.panel.open'

export interface ClientPerformancePayload {
    name: ClientPerformanceEventName
    roomId?: string | null
    sessionKey?: string | null
    rowCount?: number | null
    virtualRowCount?: number | null
    totalRows?: number | null
    durationMs?: number | null
    textLength?: number | null
    routePath?: string | null
    navigationType?: string | null
}

const pendingChatSelections = new Map<string, number>()

export function recordClientPerformance(payload: ClientPerformancePayload): void {
    void recordClientPerformanceServer({
        data: {
            name: payload.name,
            roomId: payload.roomId ?? null,
            sessionKey: payload.sessionKey ?? null,
            rowCount: payload.rowCount ?? null,
            virtualRowCount: payload.virtualRowCount ?? null,
            totalRows: payload.totalRows ?? null,
            durationMs: payload.durationMs ?? null,
            textLength: payload.textLength ?? null,
            routePath: payload.routePath ?? null,
            navigationType: payload.navigationType ?? null,
        },
    }).catch(() => {})
}

export function afterNextPaint(callback: () => void): () => void {
    let cancelled = false
    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            if (!cancelled) {
                callback()
            }
        })
    })
    return () => {
        cancelled = true
    }
}

export function markChatSelection(roomId: string, sessionKey: string): void {
    pendingChatSelections.set(selectionKey(roomId, sessionKey), performance.now())
}

export function consumeChatSelection(roomId: string, sessionKey: string): number | null {
    const key = selectionKey(roomId, sessionKey)
    const startedAt = pendingChatSelections.get(key)
    if (startedAt === undefined) {
        return null
    }
    pendingChatSelections.delete(key)
    return startedAt
}

export function peekChatSelection(roomId: string, sessionKey: string): number | null {
    return pendingChatSelections.get(selectionKey(roomId, sessionKey)) ?? null
}

export function observeLongTasks(input: {
    roomId: () => string | null
    sessionKey: () => string | null
}): () => void {
    const PerformanceObserverCtor = window.PerformanceObserver
    if (!PerformanceObserverCtor) {
        return () => {}
    }

    try {
        const observer = new PerformanceObserverCtor((list) => {
            for (const entry of list.getEntries()) {
                recordClientPerformance({
                    name: 'long.main_thread_task',
                    roomId: input.roomId(),
                    sessionKey: input.sessionKey(),
                    durationMs: entry.duration,
                })
            }
        })
        observer.observe({ type: 'longtask', buffered: true })
        return () => observer.disconnect()
    } catch {
        return () => {}
    }
}

export function routePathFromPathname(pathname: string): string {
    return pathname
        .split('/')
        .map((segment) => {
            if (!segment) return segment
            if (/^[0-9a-f-]{32,}$/i.test(segment)) return ':id'
            if (/^\d+$/.test(segment)) return ':number'
            return segment.length > 48 ? ':id' : segment
        })
        .join('/')
}

function selectionKey(roomId: string, sessionKey: string): string {
    return `${roomId}:${sessionKey}`
}
