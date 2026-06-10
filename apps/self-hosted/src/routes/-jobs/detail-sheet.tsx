import { Link } from '@tanstack/react-router'
import { StateBadge, LoadingRows } from '#/components/agent-room'
import { Button } from '#/components/ui/button'
import {
    Sheet,
    SheetContent,
    SheetDescription,
    SheetHeader,
    SheetTitle,
} from '#/components/ui/sheet'
import { formatCostUsd, formatDurationMs, formatRelativeTime, formatTokens } from '#/domain/format'
import { describeJobLastRun } from '#/domain/state'
import type { UsageEventRecord } from '#/domain/domain-types'
import type { RoomCronJob } from '#/domain/room-execution-types'

export function JobDetailSheet({
    roomId,
    job,
    usageEvents,
    usageLoading,
    onOpenChange,
}: {
    roomId: string
    job: RoomCronJob | null
    usageEvents: UsageEventRecord[]
    usageLoading: boolean
    onOpenChange: (open: boolean) => void
}) {
    const events = job ? usageEvents.filter((event) => event.jobId === job.id) : []
    const durationMs =
        events.reduce((sum, event) => sum + (event.durationMs ?? 0), 0) ||
        job?.lastDurationMs ||
        null
    const knownTokenEvents = events.filter((event) => event.totalTokens !== null)
    const knownCostEvents = events.filter((event) => event.estimatedCostUsd !== null)
    const totalTokens =
        knownTokenEvents.length === 0
            ? null
            : knownTokenEvents.reduce((sum, event) => sum + (event.totalTokens ?? 0), 0)
    const estimatedCost =
        knownCostEvents.length === 0
            ? null
            : knownCostEvents.reduce((sum, event) => sum + Number(event.estimatedCostUsd ?? 0), 0)

    return (
        <Sheet open={job !== null} onOpenChange={onOpenChange}>
            <SheetContent side="right" className="flex w-full flex-col gap-0 sm:max-w-lg">
                <SheetHeader>
                    <SheetTitle>{job?.name ?? 'Job details'}</SheetTitle>
                    <SheetDescription>
                        {job ? `${job.scheduleSummary} · ${job.timezone}` : 'Scheduled work'}
                    </SheetDescription>
                </SheetHeader>
                {job ? (
                    <div className="flex-1 space-y-4 overflow-y-auto px-4 pb-4">
                        <div className="flex flex-wrap gap-2">
                            <StateBadge
                                tone={describeJobLastRun(job.lastRunStatus).tone}
                                label={describeJobLastRun(job.lastRunStatus).label}
                            />
                            <StateBadge
                                tone={job.enabled ? 'ready' : 'muted'}
                                label={job.enabled ? 'Enabled' : 'Paused'}
                            />
                            {job.runningAt !== null ? (
                                <StateBadge tone="working" label="Running" />
                            ) : null}
                        </div>

                        <div className="grid gap-3 sm:grid-cols-3">
                            <Metric label="Duration" value={formatDurationMs(durationMs)} />
                            <Metric
                                label="Tokens"
                                value={totalTokens === null ? 'Unknown' : formatTokens(totalTokens)}
                            />
                            <Metric
                                label="Cost"
                                value={
                                    estimatedCost === null
                                        ? 'Unknown'
                                        : formatCostUsd(estimatedCost)
                                }
                            />
                        </div>

                        <DetailBlock
                            title="Instruction"
                            body={job.payloadSummary ?? 'No prompt stored'}
                        />
                        {job.lastError ? (
                            <DetailBlock title="Last error" body={job.lastError} danger />
                        ) : null}
                        <div className="grid gap-2 text-sm">
                            <DetailLine
                                label="Next run"
                                value={formatRelativeTime(job.nextRunAt)}
                            />
                            <DetailLine
                                label="Last run"
                                value={formatRelativeTime(job.lastRunAt)}
                            />
                            <DetailLine
                                label="Running since"
                                value={formatRelativeTime(job.runningAt)}
                            />
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
                                    Open artifacts
                                </Link>
                            </Button>
                            <Button asChild variant="outline" size="sm">
                                <Link to="/rooms/$roomId/usage" params={{ roomId }}>
                                    Open usage
                                </Link>
                            </Button>
                        </div>

                        <div>
                            <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                                Usage events
                            </div>
                            {usageLoading ? (
                                <div className="mt-2">
                                    <LoadingRows count={2} />
                                </div>
                            ) : events.length === 0 ? (
                                <p className="mt-1 text-sm text-muted-foreground">
                                    No job-specific usage events recorded yet.
                                </p>
                            ) : (
                                <ul className="mt-2 divide-y divide-border/60 rounded-md border border-border/60">
                                    {events.map((event) => (
                                        <li
                                            key={event.id}
                                            className="flex items-center justify-between gap-3 px-3 py-2 text-xs"
                                        >
                                            <span className="font-medium text-foreground">
                                                {event.kind}
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

function Metric({ label, value }: { label: string; value: string }) {
    return (
        <div className="rounded-md border border-border/60 bg-card p-3">
            <div className="text-xs text-muted-foreground">{label}</div>
            <div className="mt-1 text-sm font-semibold text-foreground">{value}</div>
        </div>
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
