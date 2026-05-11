import { useEffect, useState } from 'react'
import { ClockIcon } from 'lucide-react'

import { describeSessionState } from '#/lib/state'
import { formatDurationMs } from '#/lib/format'
import { cn } from '#/lib/utils'
import type { RoomExecutionThread } from '#/server/rooms/execution-types'

export function SessionRunStatus({
    thread,
    compact = false,
    className,
}: {
    thread: RoomExecutionThread | null
    compact?: boolean
    className?: string
}) {
    const [now, setNow] = useState(Date.now())
    const state = describeSessionState(thread?.status ?? null)
    const working = state.tone === 'working'

    useEffect(() => {
        if (!working) return
        const timer = window.setInterval(() => setNow(Date.now()), 1000)
        return () => window.clearInterval(timer)
    }, [working])

    if (!thread) return null

    const durationMs =
        working && thread.runStartedAt
            ? Math.max(0, now - thread.runStartedAt)
            : (thread.runtimeMs ?? null)
    if (durationMs === null) return null

    return (
        <span
            className={cn(
                'inline-flex shrink-0 items-center gap-1 rounded-md border border-border/70 bg-muted/60 text-muted-foreground',
                compact ? 'px-1.5 py-0.5 text-[0.6875rem]' : 'px-2 py-1 text-xs',
                className,
            )}
        >
            <ClockIcon className={compact ? 'size-3' : 'size-3.5'} />
            {working ? 'Working' : 'Worked'} for {formatDurationMs(durationMs)}
        </span>
    )
}
