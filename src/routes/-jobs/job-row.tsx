import type { ReactNode } from 'react'
import { ClockIcon } from 'lucide-react'
import { StateBadge, StatusDot } from '#/components/agent-room'
import { Switch } from '#/components/ui/switch'
import { describeJobLastRun } from '#/lib/state'
import type { RoomCronJob } from '#/lib/room-execution-types'

export function JobListRow({
    job,
    busy,
    schedule,
    secondaryTiming,
    actions,
    onToggle,
}: {
    job: RoomCronJob
    busy: boolean
    schedule: string
    secondaryTiming?: ReactNode
    actions: ReactNode
    onToggle: (enabled: boolean) => void
}) {
    const last = describeJobLastRun(job.lastRunStatus)
    const running = job.runningAt !== null
    return (
        <li className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:gap-4">
            <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                    <StatusDot tone={job.enabled ? 'ready' : 'muted'} pulse={running} />
                    <h3 className="truncate text-sm font-medium text-foreground">{job.name}</h3>
                </div>
                {job.description || job.payloadSummary ? (
                    <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">
                        {job.description ?? job.payloadSummary}
                    </p>
                ) : null}
                <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                    <span className="inline-flex items-center gap-1">
                        <ClockIcon className="size-3" />
                        {schedule}
                    </span>
                    {secondaryTiming}
                </div>
                {job.lastError ? (
                    <p className="mt-1 line-clamp-1 text-xs text-danger-fg">{job.lastError}</p>
                ) : null}
            </div>
            <div className="flex items-center gap-2 sm:gap-3">
                <StateBadge tone={last.tone} label={last.label} />
                <Switch
                    checked={job.enabled}
                    disabled={busy}
                    onCheckedChange={(checked) => onToggle(checked)}
                    aria-label={job.enabled ? 'Disable job' : 'Enable job'}
                />
                {actions}
            </div>
        </li>
    )
}
