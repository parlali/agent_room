import { Edit3Icon, FileTextIcon, Loader2Icon, PlayIcon, Trash2Icon } from 'lucide-react'
import { Button } from '#/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '#/components/ui/tooltip'
import { describeJobSchedule } from '#/domain/job-schedule'
import { formatDurationMs, formatRelativeTime } from '#/domain/format'
import type { RoomCronJob } from '#/domain/room-execution-types'
import { JobListRow } from './job-row'

export function JobRow({
    job,
    busy,
    onToggle,
    onRun,
    onDetails,
    onEdit,
    onDelete,
}: {
    job: RoomCronJob
    busy: boolean
    onToggle: (enabled: boolean) => void
    onRun: () => void
    onDetails: () => void
    onEdit: () => void
    onDelete: () => void
}) {
    const schedule = job.scheduleSummary || describeJobSchedule(job.schedule)
    const running = job.runningAt !== null
    return (
        <JobListRow
            job={job}
            busy={busy}
            schedule={schedule}
            onToggle={onToggle}
            secondaryTiming={
                <>
                    <span>Next: {formatRelativeTime(job.nextRunAt)}</span>
                    {job.lastDurationMs ? (
                        <span>Last took {formatDurationMs(job.lastDurationMs)}</span>
                    ) : null}
                </>
            }
            actions={
                <>
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <Button
                                variant="ghost"
                                size="icon-sm"
                                onClick={onDetails}
                                aria-label="Job details"
                            >
                                <FileTextIcon />
                            </Button>
                        </TooltipTrigger>
                        <TooltipContent>Details</TooltipContent>
                    </Tooltip>
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <Button
                                variant="ghost"
                                size="icon-sm"
                                onClick={onRun}
                                disabled={busy || running}
                                aria-label="Run now"
                            >
                                {busy ? <Loader2Icon className="animate-spin" /> : <PlayIcon />}
                            </Button>
                        </TooltipTrigger>
                        <TooltipContent>Run now</TooltipContent>
                    </Tooltip>
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <Button
                                variant="ghost"
                                size="icon-sm"
                                onClick={onEdit}
                                aria-label="Edit job"
                            >
                                <Edit3Icon />
                            </Button>
                        </TooltipTrigger>
                        <TooltipContent>Edit</TooltipContent>
                    </Tooltip>
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <Button
                                variant="ghost"
                                size="icon-sm"
                                onClick={onDelete}
                                aria-label="Delete job"
                                className="text-muted-foreground hover:text-destructive"
                            >
                                <Trash2Icon />
                            </Button>
                        </TooltipTrigger>
                        <TooltipContent>Delete</TooltipContent>
                    </Tooltip>
                </>
            }
        />
    )
}
