import { useEffect, useState } from 'react'
import { ChevronDownIcon, ChevronRightIcon, ClockIcon } from 'lucide-react'

import { Button } from '#/components/ui/button'
import { transcriptHasExpandableContent } from '#/domain/message-list-model'
import { describeSessionState } from '#/domain/state'
import { formatDurationMs } from '#/domain/format'
import { cn } from '#/lib/utils'
import type { RoomExecutionThread, RunTranscriptRow } from '#/domain/room-execution-types'

export function SessionRunStatus({
    thread,
    compact = false,
    variant = 'badge',
    className,
}: {
    thread: RoomExecutionThread | null
    compact?: boolean
    variant?: 'badge' | 'body'
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
    const label = `${working ? 'Working' : 'Worked'} for ${formatDurationMs(durationMs)}`

    if (variant === 'body') {
        return (
            <div className={cn('flex w-full flex-col gap-3 px-2', className)}>
                <div className="flex items-center gap-1 text-sm text-muted-foreground">
                    <span>{label}</span>
                    <ChevronRightIcon className="size-4" />
                </div>
                <div className="h-px w-full bg-border/70" aria-hidden />
            </div>
        )
    }

    return (
        <span
            className={cn(
                'inline-flex shrink-0 items-center gap-1 rounded-md border border-border/70 bg-muted/60 text-muted-foreground',
                compact ? 'px-1.5 py-0.5 text-[0.6875rem]' : 'px-2 py-1 text-xs',
                className,
            )}
        >
            <ClockIcon className={compact ? 'size-3' : 'size-3.5'} />
            {label}
        </span>
    )
}

export function TranscriptRunStatus({
    row,
    collapsed,
    onToggle,
    className,
}: {
    row: RunTranscriptRow
    collapsed: boolean
    onToggle: () => void
    className?: string
}) {
    const [now, setNow] = useState(Date.now())
    const active = isActiveRunStatus(row.status)
    const expandable = transcriptHasExpandableContent(row)

    useEffect(() => {
        if (!active) return
        const timer = window.setInterval(() => setNow(Date.now()), 1000)
        return () => window.clearInterval(timer)
    }, [active])

    const durationMs = transcriptDurationMs(row, active, now)
    const action = active ? 'Working' : row.status === 'stopped' ? 'Stopped' : 'Worked'
    const label =
        durationMs === null
            ? action
            : row.status === 'stopped'
              ? `${action} after ${formatDurationMs(durationMs)}`
              : `${action} for ${formatDurationMs(durationMs)}`
    const Icon = collapsed ? ChevronRightIcon : ChevronDownIcon

    if (!expandable) {
        return (
            <div
                className={cn(
                    'flex min-h-7 max-w-full items-center gap-1.5 px-1 text-left text-sm font-medium text-muted-foreground',
                    className,
                )}
            >
                <span className="truncate">{label}</span>
                {active ? <WorkingDots /> : null}
            </div>
        )
    }

    return (
        <Button
            type="button"
            variant="ghost"
            size="xs"
            className={cn(
                'h-auto min-h-7 max-w-full justify-start px-1 text-left text-sm text-muted-foreground',
                className,
            )}
            onClick={onToggle}
            aria-expanded={!collapsed}
        >
            <span className="truncate">{label}</span>
            {active ? <WorkingDots /> : null}
            <Icon className="size-4 shrink-0" />
        </Button>
    )
}

function transcriptDurationMs(row: RunTranscriptRow, active: boolean, now: number): number | null {
    if (active && row.startedAt !== null) {
        return Math.max(0, now - row.startedAt)
    }
    if (row.runtimeMs !== null) {
        return row.runtimeMs
    }
    if (row.startedAt !== null && row.timestamp !== null) {
        return Math.max(0, row.timestamp - row.startedAt)
    }
    return null
}

function WorkingDots() {
    return (
        <span className="inline-flex items-center gap-0.5" aria-hidden>
            <span className="size-1 rounded-full bg-current opacity-40 animate-pulse" />
            <span
                className="size-1 rounded-full bg-current opacity-40 animate-pulse"
                style={{ animationDelay: '150ms' }}
            />
            <span
                className="size-1 rounded-full bg-current opacity-40 animate-pulse"
                style={{ animationDelay: '300ms' }}
            />
        </span>
    )
}

function isActiveRunStatus(status: RunTranscriptRow['status']): boolean {
    return (
        status === 'queued' ||
        status === 'thinking' ||
        status === 'working' ||
        status === 'responding'
    )
}
