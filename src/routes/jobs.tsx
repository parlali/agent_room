import { createFileRoute, Link } from '@tanstack/react-router'
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { toast } from 'sonner'
import {
    ArrowRightIcon,
    CalendarClockIcon,
    ClockIcon,
    Loader2Icon,
    PlayIcon,
    Trash2Icon,
} from 'lucide-react'

import { AppShell } from '#/components/app-shell'
import {
    EmptyState,
    LoadingRows,
    PageHeader,
    RoomGlyph,
    Section,
    StateBadge,
    StatusDot,
} from '#/components/agent-room'
import { Button } from '#/components/ui/button'
import { Switch } from '#/components/ui/switch'
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '#/components/ui/dialog'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '#/components/ui/tooltip'
import { formatRelativeTime, pluralize } from '#/lib/format'
import { describeJobLastRun, describeSchedule } from '#/lib/state'
import {
    listCronJobsServer,
    listRoomsServer,
    removeCronJobServer,
    runCronJobServer,
    setCronEnabledServer,
} from './-room-runtime-server'
import { requireRouteUser } from './-route-auth'
import type { RoomCronJob, RoomRuntimeOverview } from '#/server/rooms/execution-types'

export const Route = createFileRoute('/jobs')({
    beforeLoad: requireRouteUser,
    component: JobsPage,
})

interface RoomGroup {
    room: RoomRuntimeOverview
    jobs: RoomCronJob[]
}

function describeError(e: unknown): string {
    return e instanceof Error ? e.message : 'Unexpected error'
}

function JobsPage() {
    const queryClient = useQueryClient()
    const roomsQuery = useQuery({
        queryKey: ['rooms-list'],
        queryFn: () => listRoomsServer(),
        staleTime: 30_000,
    })
    const rooms = roomsQuery.data ?? []

    const jobQueries = useQueries({
        queries: rooms.map((room) => ({
            queryKey: ['room-cron-jobs', room.roomId],
            queryFn: () => listCronJobsServer({ data: { roomId: room.roomId } }),
            staleTime: 30_000,
        })),
    })

    const groups: RoomGroup[] = rooms
        .map((room, index) => ({
            room,
            jobs: (jobQueries[index]?.data as RoomCronJob[] | undefined) ?? [],
        }))
        .filter((group) => group.jobs.length > 0)
        .map((group) => ({
            ...group,
            jobs: [...group.jobs].sort((a, b) => {
                const ax = a.nextRunAt ?? Number.MAX_SAFE_INTEGER
                const bx = b.nextRunAt ?? Number.MAX_SAFE_INTEGER
                return ax - bx
            }),
        }))

    const totalJobs = groups.reduce((sum, group) => sum + group.jobs.length, 0)
    const isLoading = roomsQuery.isLoading || jobQueries.some((q) => q.isLoading)

    const [pendingJobId, setPendingJobId] = useState<string | null>(null)
    const [deleteTarget, setDeleteTarget] = useState<{ roomId: string; job: RoomCronJob } | null>(
        null,
    )

    const invalidateRoom = (roomId: string) =>
        queryClient.invalidateQueries({ queryKey: ['room-cron-jobs', roomId] })

    const toggleMutation = useMutation({
        mutationFn: (input: { roomId: string; jobId: string; enabled: boolean }) =>
            setCronEnabledServer({
                data: { roomId: input.roomId, jobId: input.jobId, enabled: input.enabled },
            }),
        onMutate: ({ jobId }) => setPendingJobId(jobId),
        onSuccess: async (_d, v) => {
            await invalidateRoom(v.roomId)
            toast.success(v.enabled ? 'Job enabled' : 'Job disabled')
        },
        onError: (e) => toast.error('Could not update job', { description: describeError(e) }),
        onSettled: () => setPendingJobId(null),
    })

    const runMutation = useMutation({
        mutationFn: (input: { roomId: string; jobId: string }) =>
            runCronJobServer({ data: { roomId: input.roomId, jobId: input.jobId } }),
        onMutate: ({ jobId }) => setPendingJobId(jobId),
        onSuccess: async (result, v) => {
            await invalidateRoom(v.roomId)
            if (result.ran) {
                toast.success('Job started')
            } else {
                toast.message('Job not started', {
                    description: result.reason ?? 'No reason provided',
                })
            }
        },
        onError: (e) => toast.error('Could not run job', { description: describeError(e) }),
        onSettled: () => setPendingJobId(null),
    })

    const removeMutation = useMutation({
        mutationFn: (input: { roomId: string; jobId: string }) =>
            removeCronJobServer({ data: { roomId: input.roomId, jobId: input.jobId } }),
        onSuccess: async (_d, v) => {
            await invalidateRoom(v.roomId)
            toast.success('Job deleted')
            setDeleteTarget(null)
        },
        onError: (e) => toast.error('Could not delete job', { description: describeError(e) }),
    })

    return (
        <AppShell>
            <TooltipProvider>
                <div className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6">
                    <PageHeader
                        title="Jobs"
                        subtitle={
                            totalJobs === 0
                                ? 'Recurring work scheduled across your rooms.'
                                : `${totalJobs} ${pluralize(totalJobs, 'scheduled job')} across ${groups.length} ${pluralize(groups.length, 'room')}.`
                        }
                    />

                    <div className="mt-6 space-y-4">
                        {isLoading && groups.length === 0 ? (
                            <Section>
                                <LoadingRows count={4} />
                            </Section>
                        ) : groups.length === 0 ? (
                            <EmptyState
                                icon={CalendarClockIcon}
                                title="No scheduled jobs in any room yet."
                                description="Open a room and create a job to schedule recurring work."
                            />
                        ) : (
                            groups.map((group) => (
                                <RoomJobGroup
                                    key={group.room.roomId}
                                    group={group}
                                    pendingJobId={pendingJobId}
                                    onToggle={(jobId, enabled) =>
                                        toggleMutation.mutate({
                                            roomId: group.room.roomId,
                                            jobId,
                                            enabled,
                                        })
                                    }
                                    onRun={(jobId) =>
                                        runMutation.mutate({ roomId: group.room.roomId, jobId })
                                    }
                                    onDelete={(job) =>
                                        setDeleteTarget({ roomId: group.room.roomId, job })
                                    }
                                />
                            ))
                        )}
                    </div>
                </div>
            </TooltipProvider>

            <Dialog
                open={deleteTarget !== null}
                onOpenChange={(open) => {
                    if (!open) setDeleteTarget(null)
                }}
            >
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Delete this job?</DialogTitle>
                        <DialogDescription>
                            {deleteTarget
                                ? `"${deleteTarget.job.name}" will stop running. This cannot be undone.`
                                : null}
                        </DialogDescription>
                    </DialogHeader>
                    <DialogFooter>
                        <Button
                            variant="outline"
                            onClick={() => setDeleteTarget(null)}
                            disabled={removeMutation.isPending}
                        >
                            Cancel
                        </Button>
                        <Button
                            variant="destructive"
                            onClick={() => {
                                if (deleteTarget) {
                                    removeMutation.mutate({
                                        roomId: deleteTarget.roomId,
                                        jobId: deleteTarget.job.id,
                                    })
                                }
                            }}
                            disabled={removeMutation.isPending}
                        >
                            {removeMutation.isPending ? (
                                <Loader2Icon className="animate-spin" />
                            ) : (
                                <Trash2Icon />
                            )}
                            Delete
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </AppShell>
    )
}

function RoomJobGroup({
    group,
    pendingJobId,
    onToggle,
    onRun,
    onDelete,
}: {
    group: RoomGroup
    pendingJobId: string | null
    onToggle: (jobId: string, enabled: boolean) => void
    onRun: (jobId: string) => void
    onDelete: (job: RoomCronJob) => void
}) {
    return (
        <Section
            title={
                <span className="inline-flex items-center gap-2">
                    <RoomGlyph name={group.room.displayName} seed={group.room.roomId} size="sm" />
                    <span className="truncate">{group.room.displayName}</span>
                </span>
            }
            description={`${group.jobs.length} ${pluralize(group.jobs.length, 'job')}`}
            actions={
                <Link to="/rooms/$roomId/jobs" params={{ roomId: group.room.roomId }}>
                    <Button variant="ghost" size="sm">
                        View room
                        <ArrowRightIcon />
                    </Button>
                </Link>
            }
            bodyClassName="p-0"
        >
            <ul className="divide-y divide-border/60">
                {group.jobs.map((job) => (
                    <JobRow
                        key={job.id}
                        roomId={group.room.roomId}
                        job={job}
                        busy={pendingJobId === job.id}
                        onToggle={(enabled) => onToggle(job.id, enabled)}
                        onRun={() => onRun(job.id)}
                        onDelete={() => onDelete(job)}
                    />
                ))}
            </ul>
        </Section>
    )
}

function JobRow({
    roomId,
    job,
    busy,
    onToggle,
    onRun,
    onDelete,
}: {
    roomId: string
    job: RoomCronJob
    busy: boolean
    onToggle: (enabled: boolean) => void
    onRun: () => void
    onDelete: () => void
}) {
    const last = describeJobLastRun(job.lastRunStatus)
    const schedule = job.scheduleSummary || describeSchedule(null)
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
                    <span>Next: {formatRelativeTime(job.nextRunAt)}</span>
                    {job.lastRunAt ? (
                        <span>Last run {formatRelativeTime(job.lastRunAt)}</span>
                    ) : null}
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
                        <Link to="/rooms/$roomId/jobs" params={{ roomId }}>
                            <Button variant="ghost" size="icon-sm" aria-label="View room">
                                <ArrowRightIcon />
                            </Button>
                        </Link>
                    </TooltipTrigger>
                    <TooltipContent>View room</TooltipContent>
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
            </div>
        </li>
    )
}
