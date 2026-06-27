import { ClockIcon } from 'lucide-react'
import { StatusDot } from '#/components/agent-room'
import { describeJobSchedule } from '#/domain/job-schedule'
import { formatDurationMs, formatRelativeTime } from '#/domain/format'
import { sanitizeRuntimeError } from '#/domain/runtime-error'
import type { RoomCronJob } from '#/domain/room-execution-types'

function scheduleUsesTimezone(job: RoomCronJob): boolean {
    return job.schedule.type !== 'interval'
}

export function JobNameCell({ job, onDetails }: { job: RoomCronJob; onDetails: () => void }) {
    const running = job.runningAt !== null
    return (
        <div className="min-w-0">
            <div className="flex items-center gap-2">
                <StatusDot tone={job.enabled ? 'ready' : 'muted'} pulse={running} />
                <button
                    type="button"
                    className="truncate text-left text-sm font-medium text-foreground hover:underline"
                    onClick={onDetails}
                >
                    {job.name}
                </button>
            </div>
            {job.description || job.payloadSummary ? (
                <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">
                    {job.description ?? job.payloadSummary}
                </p>
            ) : null}
            {job.lastError ? (
                <p className="mt-1 line-clamp-2 text-xs text-danger-fg">
                    {sanitizeRuntimeError(job.lastError)}
                </p>
            ) : null}
        </div>
    )
}

export function JobScheduleCell({ job }: { job: RoomCronJob }) {
    const schedule = job.scheduleSummary || describeJobSchedule(job.schedule)
    return (
        <div className="flex flex-col gap-0.5 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1 text-foreground">
                <ClockIcon className="size-3 shrink-0" />
                {schedule}
                {scheduleUsesTimezone(job) ? ` · ${job.timezone}` : ''}
            </span>
            <span>Next: {formatRelativeTime(job.nextRunAt)}</span>
            {job.lastDurationMs ? (
                <span>Last took {formatDurationMs(job.lastDurationMs)}</span>
            ) : null}
        </div>
    )
}
