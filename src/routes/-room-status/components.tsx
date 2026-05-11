import { Link } from '@tanstack/react-router'
import {
    AlertTriangleIcon,
    CheckCircle2Icon,
    ClockIcon,
    LoaderIcon,
    XCircleIcon,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

import { EmptyState, Section, StateBadge, StatusDot } from '#/components/agent-room'
import { Button } from '#/components/ui/button'
import { ScrollArea } from '#/components/ui/scroll-area'
import {
    Sheet,
    SheetContent,
    SheetDescription,
    SheetHeader,
    SheetTitle,
} from '#/components/ui/sheet'
import { formatDurationMs, formatRelativeTime } from '#/lib/format'
import type { RoomRunHistoryEntry } from '#/lib/room-execution-types'

import { classifyRun, type CheckRow, type OverallStatus, type OverallTone } from './model'

const overallToneClass: Record<OverallTone, string> = {
    ready: 'border-ready/40 bg-ready-soft text-ready-fg',
    working: 'border-working/40 bg-working-soft text-working-fg',
    attention: 'border-attention/40 bg-attention-soft text-attention-fg',
    danger: 'border-danger/40 bg-danger-soft text-danger-fg',
}

export function OverallBanner({ status }: { status: OverallStatus }) {
    const Icon =
        status.tone === 'ready'
            ? CheckCircle2Icon
            : status.tone === 'working'
              ? LoaderIcon
              : status.tone === 'danger'
                ? XCircleIcon
                : AlertTriangleIcon

    return (
        <div
            className={`flex items-start gap-3 rounded-xl border px-4 py-4 ${overallToneClass[status.tone]}`}
            role={status.tone === 'danger' ? 'alert' : 'status'}
        >
            <Icon
                className={`size-6 shrink-0 ${status.tone === 'working' ? 'animate-spin' : ''}`}
                aria-hidden
            />
            <div className="min-w-0 flex-1">
                <div className="text-base font-semibold leading-tight">{status.label}</div>
                <p className="mt-1 text-sm leading-relaxed opacity-90">{status.description}</p>
            </div>
        </div>
    )
}

export function ChecksSection({ checks }: { checks: CheckRow[] }) {
    return (
        <Section title="Checks" description="What is working in this room right now.">
            <div className="grid gap-2 sm:grid-cols-2">
                {checks.map((row) => (
                    <CheckCard key={row.label} row={row} />
                ))}
            </div>
        </Section>
    )
}

export function LastWorkSummary({
    roomId,
    lastSuccess,
    lastFailure,
}: {
    roomId: string
    lastSuccess: RoomRunHistoryEntry | null
    lastFailure: RoomRunHistoryEntry | null
}) {
    return (
        <div className="grid gap-3 sm:grid-cols-2">
            <LastWorkRow
                title="Last successful work"
                icon={CheckCircle2Icon}
                entry={lastSuccess}
                roomId={roomId}
                emptyText="Nothing has finished yet."
            />
            <LastWorkRow
                title="Last failed work"
                icon={AlertTriangleIcon}
                entry={lastFailure}
                roomId={roomId}
                emptyText="No failures recorded."
            />
        </div>
    )
}

export function RecentRunsSection({
    history,
    onSelect,
}: {
    history: RoomRunHistoryEntry[]
    onSelect: (entry: RoomRunHistoryEntry) => void
}) {
    const visible = history.slice(0, 8)
    if (visible.length === 0) {
        return (
            <Section title="Recent runs" description="Most recent first.">
                <EmptyState
                    icon={ClockIcon}
                    title="No runs yet"
                    description="Sessions and job runs will show here once they happen."
                />
            </Section>
        )
    }

    return (
        <Section
            title="Recent runs"
            description="Most recent first. Click a run to see the reason."
            bodyClassName="p-0"
        >
            <ul className="divide-y divide-border/60">
                {visible.map((entry) => {
                    const outcome = classifyRun(entry.status)
                    const subtitle = entry.summary ?? entry.error ?? null
                    return (
                        <li key={entry.id}>
                            <button
                                type="button"
                                onClick={() => onSelect(entry)}
                                className="flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/50"
                            >
                                <span className="mt-1.5">
                                    <StatusDot tone={outcome.tone} />
                                </span>
                                <div className="min-w-0 flex-1">
                                    <div className="flex items-center gap-2">
                                        <span className="truncate text-sm font-medium text-foreground">
                                            {entry.jobName ?? 'Session message'}
                                        </span>
                                        <StateBadge tone={outcome.tone} label={outcome.label} />
                                    </div>
                                    {subtitle ? (
                                        <p className="mt-0.5 truncate text-xs text-muted-foreground">
                                            {subtitle}
                                        </p>
                                    ) : null}
                                </div>
                                <span className="shrink-0 whitespace-nowrap text-xs text-muted-foreground">
                                    {formatRelativeTime(entry.ts)}
                                </span>
                            </button>
                        </li>
                    )
                })}
            </ul>
        </Section>
    )
}

export function RunDetailSheet({
    entry,
    open,
    onOpenChange,
    roomId,
}: {
    entry: RoomRunHistoryEntry | null
    open: boolean
    onOpenChange: (next: boolean) => void
    roomId: string
}) {
    return (
        <Sheet open={open} onOpenChange={onOpenChange}>
            <SheetContent side="right" className="flex flex-col gap-0">
                <SheetHeader className="border-b border-border/60">
                    <SheetTitle>{entry?.jobName ?? 'Session message'}</SheetTitle>
                    <SheetDescription>
                        {entry ? formatRelativeTime(entry.ts) : 'Run details'}
                    </SheetDescription>
                </SheetHeader>
                <ScrollArea className="flex-1">
                    {entry ? (
                        <div className="space-y-4 p-4">
                            <div className="flex items-center gap-2">
                                <StateBadge
                                    tone={classifyRun(entry.status).tone}
                                    label={classifyRun(entry.status).label}
                                />
                                {entry.durationMs !== null ? (
                                    <span className="text-xs text-muted-foreground">
                                        Took {formatDurationMs(entry.durationMs)}
                                    </span>
                                ) : null}
                            </div>
                            {entry.summary ? (
                                <DetailBlock title="What happened" body={entry.summary} />
                            ) : null}
                            {entry.error ? (
                                <DetailBlock title="Reason" body={entry.error} danger />
                            ) : null}
                            <div className="flex flex-wrap gap-2 pt-2">
                                {entry.sessionKey ? (
                                    <Button asChild variant="outline" size="sm">
                                        <Link
                                            to="/rooms/$roomId/sessions/$sessionKey"
                                            params={{ roomId, sessionKey: entry.sessionKey }}
                                        >
                                            Open session
                                        </Link>
                                    </Button>
                                ) : null}
                                {entry.jobId ? (
                                    <Button asChild variant="outline" size="sm">
                                        <Link to="/rooms/$roomId/jobs" params={{ roomId }}>
                                            Open jobs
                                        </Link>
                                    </Button>
                                ) : null}
                            </div>
                        </div>
                    ) : null}
                </ScrollArea>
            </SheetContent>
        </Sheet>
    )
}

function CheckCard({ row }: { row: CheckRow }) {
    const Icon = row.icon
    return (
        <div className="flex items-start gap-3 rounded-lg border border-border/60 bg-card px-4 py-3">
            <span className="mt-0.5">
                <StatusDot tone={row.tone} />
            </span>
            <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                    <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                    <div className="text-sm font-medium text-foreground">{row.label}</div>
                </div>
                <p className="mt-0.5 text-xs text-muted-foreground">{row.detail}</p>
            </div>
        </div>
    )
}

function LastWorkRow({
    title,
    icon: Icon,
    entry,
    roomId,
    emptyText,
}: {
    title: string
    icon: LucideIcon
    entry: RoomRunHistoryEntry | null
    roomId: string
    emptyText: string
}) {
    return (
        <div className="flex items-center gap-3 rounded-lg border border-border/60 bg-card px-4 py-3">
            <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            <div className="min-w-0 flex-1">
                <div className="text-sm font-medium text-foreground">{title}</div>
                {entry ? (
                    <p className="mt-0.5 truncate text-xs text-muted-foreground">
                        {formatRelativeTime(entry.ts)}
                        {' · '}
                        {lastWorkLink(roomId, entry, entry.jobName ?? 'Session message')}
                    </p>
                ) : (
                    <p className="mt-0.5 text-xs text-muted-foreground">{emptyText}</p>
                )}
            </div>
        </div>
    )
}

function lastWorkLink(roomId: string, entry: RoomRunHistoryEntry, label: string) {
    const cls = 'font-medium text-foreground underline-offset-4 hover:underline'
    if (entry.sessionKey) {
        return (
            <Link
                to="/rooms/$roomId/sessions/$sessionKey"
                params={{ roomId, sessionKey: entry.sessionKey }}
                className={cls}
            >
                {label}
            </Link>
        )
    }

    if (entry.jobId) {
        return (
            <Link to="/rooms/$roomId/jobs" params={{ roomId }} className={cls}>
                {label}
            </Link>
        )
    }

    return <span className={cls}>{label}</span>
}

function DetailBlock({ title, body, danger }: { title: string; body: string; danger?: boolean }) {
    return (
        <div>
            <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {title}
            </div>
            <p
                className={`mt-1 whitespace-pre-wrap text-sm leading-relaxed ${danger ? 'text-danger-fg' : 'text-foreground'}`}
            >
                {body}
            </p>
        </div>
    )
}
