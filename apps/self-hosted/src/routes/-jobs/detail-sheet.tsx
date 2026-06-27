import { Link } from '@tanstack/react-router'
import { Stat, StatGrid, StateBadge, LoadingRows } from '#/components/agent-room'
import { usageKindLabel } from '#/domain/capability-labels'
import { Button } from '#/components/ui/button'
import {
    Sheet,
    SheetContent,
    SheetDescription,
    SheetHeader,
    SheetTitle,
} from '#/components/ui/sheet'
import {
    formatCostUsd,
    formatDurationMs,
    formatRelativeTime,
    formatTokens,
    pluralize,
} from '#/domain/format'
import type { RoomCronJob } from '#/domain/room-execution-types'
import { sanitizeRuntimeError } from '#/domain/runtime-error'
import { describeScheduledTaskLastRun } from './last-run'
import type { ScheduledTaskUsage } from './usage-server'

export function JobDetailSheet({
    roomId,
    job,
    usage,
    usageLoading,
    onOpenChange,
}: {
    roomId: string
    job: RoomCronJob | null
    usage: ScheduledTaskUsage | null
    usageLoading: boolean
    onOpenChange: (open: boolean) => void
}) {
    const totals = usage?.totals ?? null
    const events = usage?.events ?? []
    const runCount = totals?.runCount ?? 0
    const lastRun = job ? describeScheduledTaskLastRun(job.lastRunStatus) : null
    const acrossRuns = `Across ${runCount} ${pluralize(runCount, 'run')}`

    return (
        <Sheet open={job !== null} onOpenChange={onOpenChange}>
            <SheetContent side="right" className="flex w-full flex-col gap-0 sm:max-w-lg">
                <SheetHeader>
                    <SheetTitle>{job?.name ?? 'Scheduled task'}</SheetTitle>
                    <SheetDescription>
                        {job ? `${job.scheduleSummary} · ${job.timezone}` : 'Scheduled work'}
                    </SheetDescription>
                </SheetHeader>
                {job && lastRun ? (
                    <div className="flex-1 space-y-4 overflow-y-auto px-4 pb-4">
                        <div className="flex flex-wrap gap-2">
                            <StateBadge tone={lastRun.tone} label={lastRun.label} />
                            <StateBadge
                                tone={job.enabled ? 'ready' : 'muted'}
                                label={job.enabled ? 'Enabled' : 'Paused'}
                            />
                            {job.runningAt !== null ? (
                                <StateBadge tone="working" label="Running" pulse />
                            ) : null}
                        </div>

                        <StatGrid className="sm:grid-cols-3 lg:grid-cols-3">
                            <Stat
                                label="Total time"
                                value={usageLoading ? '…' : formatDurationMs(totals?.durationMs)}
                                hint={acrossRuns}
                            />
                            <Stat
                                label="Total tokens"
                                value={
                                    usageLoading
                                        ? '…'
                                        : totals === null || totals.totalTokens === null
                                          ? 'Not recorded'
                                          : formatTokens(totals.totalTokens)
                                }
                                hint={acrossRuns}
                            />
                            <Stat
                                label="Total cost"
                                value={
                                    usageLoading
                                        ? '…'
                                        : totals === null || totals.estimatedCostUsd === null
                                          ? 'Not recorded'
                                          : formatCostUsd(totals.estimatedCostUsd)
                                }
                                hint={acrossRuns}
                            />
                        </StatGrid>

                        {usage?.windowed ? (
                            <p className="text-xs text-muted-foreground">
                                Totals cover this task&apos;s most recent activity in a busy room
                                and may understate older runs.
                            </p>
                        ) : null}

                        <DetailBlock
                            title="Instruction"
                            body={job.payloadSummary ?? 'No instruction stored'}
                        />
                        {job.lastError ? (
                            <DetailBlock
                                title="Last error"
                                body={sanitizeRuntimeError(job.lastError)}
                                danger
                            />
                        ) : null}
                        <div className="grid gap-2 text-sm">
                            <DetailLine
                                label="Next run"
                                value={formatRelativeTime(job.nextRunAt)}
                            />
                            <DetailLine
                                label="Last run"
                                value={
                                    job.lastRunAt === null
                                        ? 'Not run yet'
                                        : formatRelativeTime(job.lastRunAt)
                                }
                            />
                            {job.runningAt !== null ? (
                                <DetailLine
                                    label="Running since"
                                    value={formatRelativeTime(job.runningAt)}
                                />
                            ) : null}
                            {job.lastDurationMs ? (
                                <DetailLine
                                    label="Last run took"
                                    value={formatDurationMs(job.lastDurationMs)}
                                />
                            ) : null}
                        </div>

                        <div className="flex flex-wrap gap-2">
                            {job.sessionKey ? (
                                <Button asChild variant="outline" size="sm">
                                    <Link
                                        to="/rooms/$roomId/sessions/$sessionKey"
                                        params={{ roomId, sessionKey: job.sessionKey }}
                                    >
                                        Open session
                                    </Link>
                                </Button>
                            ) : null}
                            <Button asChild variant="outline" size="sm">
                                <Link to="/rooms/$roomId/files" params={{ roomId }}>
                                    Open files
                                </Link>
                            </Button>
                        </div>

                        <div>
                            <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                                Recent runs
                            </div>
                            {usageLoading ? (
                                <div className="mt-2">
                                    <LoadingRows count={2} />
                                </div>
                            ) : events.length === 0 ? (
                                <p className="mt-1 text-sm text-muted-foreground">
                                    No usage recorded for this task yet.
                                </p>
                            ) : (
                                <ul className="mt-2 divide-y divide-border/60 rounded-md border border-border/60">
                                    {events.map((event) => (
                                        <li
                                            key={event.id}
                                            className="flex items-center justify-between gap-3 px-3 py-2 text-xs"
                                        >
                                            <span className="font-medium text-foreground">
                                                {usageKindLabel(event.kind)}
                                            </span>
                                            <span className="text-muted-foreground">
                                                {formatRelativeTime(event.createdAt)} -{' '}
                                                {formatDurationMs(event.durationMs)}
                                            </span>
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </div>
                    </div>
                ) : null}
            </SheetContent>
        </Sheet>
    )
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

function DetailLine({ label, value }: { label: string; value: string }) {
    return (
        <div className="flex items-center justify-between gap-3 rounded-md border border-border/60 px-3 py-2">
            <span className="text-muted-foreground">{label}</span>
            <span className="font-medium text-foreground">{value}</span>
        </div>
    )
}
