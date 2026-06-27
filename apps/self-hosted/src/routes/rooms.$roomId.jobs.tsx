import { createFileRoute } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { CalendarClockIcon, PlusIcon, RefreshCwIcon } from 'lucide-react'

import { RoomSetupRequiredState } from '#/components/room-dashboard'
import {
    DataTable,
    EmptyState,
    LoadingRows,
    Section,
    StateBadge,
    type DataColumn,
} from '#/components/agent-room'
import { Button } from '#/components/ui/button'
import { Switch } from '#/components/ui/switch'
import { pluralize } from '#/domain/format'
import { roomQueryKey, roomQueryPolicy } from '#/lib/room-query-keys'
import {
    createCronJobServer,
    getRoomSidebarServer,
    listCronJobsServer,
    removeCronJobServer,
    runCronJobServer,
    setCronEnabledServer,
    updateCronJobServer,
} from '#/routes/-room-runtime-server'
import { getRoomConfigServer } from '#/routes/-operator-config-server'
import type { RoomCronJob } from '#/domain/room-execution-types'
import { JobDeleteDialog } from './-jobs/delete-dialog'
import { JobDetailSheet } from './-jobs/detail-sheet'
import { JobFormSheet } from './-jobs/form-sheet'
import { JobNameCell, JobScheduleCell } from './-jobs/job-row'
import { describeScheduledTaskLastRun, isScheduledTaskFailure } from './-jobs/last-run'
import { describeJobMutationError, emptyJobForm, jobToForm, type JobFormState } from './-jobs/model'
import { JobRowActions } from './-jobs/row-actions'
import { listJobUsageServer } from './-jobs/usage-server'

export const Route = createFileRoute('/rooms/$roomId/jobs')({
    component: RoomJobsPage,
})

function isFailingTask(job: RoomCronJob): boolean {
    return isScheduledTaskFailure(job.lastRunStatus) || job.lastError !== null
}

function sortTasks(jobs: RoomCronJob[]): RoomCronJob[] {
    return [...jobs].sort((a, b) => {
        const failingDelta = Number(isFailingTask(b)) - Number(isFailingTask(a))
        if (failingDelta !== 0) return failingDelta
        const enabledDelta = Number(b.enabled) - Number(a.enabled)
        if (enabledDelta !== 0) return enabledDelta
        return (a.nextRunAt ?? Infinity) - (b.nextRunAt ?? Infinity)
    })
}

function RoomJobsPage() {
    const { roomId } = Route.useParams()
    const queryClient = useQueryClient()

    const jobsQuery = useQuery<RoomCronJob[]>({
        queryKey: roomQueryKey.roomCronJobs(roomId),
        queryFn: () => listCronJobsServer({ data: { roomId } }),
        staleTime: roomQueryPolicy.hotStaleMs,
        refetchInterval: roomQueryPolicy.sidebarPollMs,
    })
    const configQuery = useQuery({
        queryKey: roomQueryKey.roomConfig(roomId),
        queryFn: () => getRoomConfigServer({ data: { roomId } }),
        staleTime: roomQueryPolicy.coldStaleMs,
    })
    const sidebarQuery = useQuery({
        queryKey: roomQueryKey.roomSidebar(roomId),
        queryFn: () => getRoomSidebarServer({ data: { roomId } }),
        staleTime: roomQueryPolicy.hotStaleMs,
    })
    const setupRequired = sidebarQuery.data?.setup.phase === 'setup_required'

    const [createOpen, setCreateOpen] = useState(false)
    const [editJob, setEditJob] = useState<RoomCronJob | null>(null)
    const [deleteJob, setDeleteJob] = useState<RoomCronJob | null>(null)
    const [detailJob, setDetailJob] = useState<RoomCronJob | null>(null)
    const [pendingJobId, setPendingJobId] = useState<string | null>(null)

    const invalidate = () =>
        queryClient.invalidateQueries({ queryKey: roomQueryKey.roomCronJobs(roomId) })

    const createMutation = useMutation({
        mutationFn: (form: JobFormState) => createCronJobServer({ data: { roomId, ...form } }),
        onSuccess: async () => {
            await invalidate()
            toast.success('Scheduled task created')
            setCreateOpen(false)
        },
        onError: (e) =>
            toast.error('Could not create task', { description: describeJobMutationError(e) }),
    })

    const editMutation = useMutation({
        mutationFn: async (input: { previous: RoomCronJob; form: JobFormState }) => {
            return updateCronJobServer({
                data: {
                    roomId,
                    jobId: input.previous.id,
                    ...input.form,
                },
            })
        },
        onSuccess: async () => {
            await invalidate()
            toast.success('Scheduled task updated')
            setEditJob(null)
        },
        onError: (e) =>
            toast.error('Could not update task', { description: describeJobMutationError(e) }),
    })

    const removeMutation = useMutation({
        mutationFn: (jobId: string) => removeCronJobServer({ data: { roomId, jobId } }),
        onSuccess: async () => {
            await invalidate()
            toast.success('Scheduled task deleted')
            setDeleteJob(null)
        },
        onError: (e) =>
            toast.error('Could not delete task', { description: describeJobMutationError(e) }),
    })

    const toggleMutation = useMutation({
        mutationFn: (input: { jobId: string; enabled: boolean }) =>
            setCronEnabledServer({ data: { roomId, ...input } }),
        onMutate: ({ jobId }) => setPendingJobId(jobId),
        onSuccess: async (_d, v) => {
            await invalidate()
            toast.success(v.enabled ? 'Task enabled' : 'Task paused')
        },
        onError: (e) =>
            toast.error('Could not update task', { description: describeJobMutationError(e) }),
        onSettled: () => setPendingJobId(null),
    })

    const runMutation = useMutation({
        mutationFn: (jobId: string) => runCronJobServer({ data: { roomId, jobId } }),
        onMutate: (jobId) => setPendingJobId(jobId),
        onSuccess: async (result) => {
            await invalidate()
            if (result.ran) toast.success('Task started')
            else
                toast.message('Task not started', {
                    description: result.reason ?? 'No reason provided',
                })
        },
        onError: (e) =>
            toast.error('Could not run task', { description: describeJobMutationError(e) }),
        onSettled: () => setPendingJobId(null),
    })

    const jobs = jobsQuery.data ?? []
    const sortedJobs = useMemo(() => sortTasks(jobs), [jobs])
    const failingCount = useMemo(() => jobs.filter(isFailingTask).length, [jobs])
    const timezone = configQuery.data?.config.cronTimezone ?? null
    const canCreateTask = !setupRequired && timezone !== null

    const detailJobId = detailJob?.id ?? null
    const usageQuery = useQuery({
        queryKey: roomQueryKey.roomUsage(roomId, detailJobId ? `job:${detailJobId}` : 'job'),
        queryFn: () => listJobUsageServer({ data: { roomId, jobId: detailJobId! } }),
        enabled: detailJobId !== null,
        staleTime: roomQueryPolicy.hotStaleMs,
    })

    const isLoading = jobsQuery.isLoading || configQuery.isLoading
    const isEmpty = !isLoading && jobs.length === 0

    const columns: DataColumn<RoomCronJob>[] = [
        {
            id: 'task',
            header: 'Task',
            cell: (job) => <JobNameCell job={job} onDetails={() => setDetailJob(job)} />,
        },
        {
            id: 'schedule',
            header: 'Schedule',
            cell: (job) => <JobScheduleCell job={job} />,
        },
        {
            id: 'lastRun',
            header: 'Last run',
            cell: (job) => {
                const state = describeScheduledTaskLastRun(job.lastRunStatus)
                return <StateBadge tone={state.tone} label={state.label} />
            },
        },
        {
            id: 'enabled',
            header: 'Enabled',
            align: 'center',
            cell: (job) => (
                <Switch
                    checked={job.enabled}
                    disabled={pendingJobId === job.id}
                    onCheckedChange={(checked) =>
                        toggleMutation.mutate({ jobId: job.id, enabled: checked })
                    }
                    aria-label={job.enabled ? 'Pause task' : 'Enable task'}
                />
            ),
        },
        {
            id: 'actions',
            header: 'Actions',
            align: 'end',
            cell: (job) => (
                <JobRowActions
                    busy={pendingJobId === job.id}
                    running={job.runningAt !== null}
                    onRun={() => runMutation.mutate(job.id)}
                    onDetails={() => setDetailJob(job)}
                    onEdit={() => setEditJob(job)}
                    onDelete={() => setDeleteJob(job)}
                />
            ),
        },
    ]

    return (
        <>
            <div className="flex flex-col gap-6">
                <Section
                    title="Scheduled tasks"
                    description="Recurring work this room does on its own."
                    actions={
                        <div className="flex flex-wrap items-center gap-2">
                            {failingCount > 0 ? (
                                <StateBadge
                                    tone="danger"
                                    label={`${failingCount} ${pluralize(failingCount, 'failing')}`}
                                />
                            ) : null}
                            {canCreateTask ? (
                                <Button size="sm" onClick={() => setCreateOpen(true)}>
                                    <PlusIcon />
                                    New task
                                </Button>
                            ) : null}
                        </div>
                    }
                    bodyClassName={isLoading ? 'p-4' : 'p-0'}
                >
                    {isLoading ? (
                        <LoadingRows count={3} />
                    ) : setupRequired ? (
                        <div className="p-4">
                            <RoomSetupRequiredState description="Finish setup so this room can run scheduled tasks." />
                        </div>
                    ) : configQuery.isError || timezone === null ? (
                        <div className="p-4">
                            <EmptyState
                                icon={CalendarClockIcon}
                                title="Could not load schedule settings"
                                description="Task scheduling needs this room's configured timezone."
                                action={
                                    <Button
                                        size="sm"
                                        variant="outline"
                                        onClick={() => void configQuery.refetch()}
                                    >
                                        <RefreshCwIcon />
                                        Try again
                                    </Button>
                                }
                            />
                        </div>
                    ) : jobsQuery.isError ? (
                        <div className="p-4">
                            <EmptyState
                                icon={CalendarClockIcon}
                                title="Could not load scheduled tasks"
                                description={describeJobMutationError(jobsQuery.error)}
                                action={
                                    <Button
                                        size="sm"
                                        variant="outline"
                                        onClick={() => void jobsQuery.refetch()}
                                    >
                                        <RefreshCwIcon />
                                        Try again
                                    </Button>
                                }
                            />
                        </div>
                    ) : isEmpty ? (
                        <div className="p-4">
                            <EmptyState
                                icon={CalendarClockIcon}
                                title="No scheduled tasks yet"
                                description="Schedule something for this room to do automatically."
                                action={
                                    canCreateTask ? (
                                        <Button size="sm" onClick={() => setCreateOpen(true)}>
                                            <PlusIcon />
                                            New task
                                        </Button>
                                    ) : null
                                }
                            />
                        </div>
                    ) : (
                        <DataTable
                            rows={sortedJobs}
                            columns={columns}
                            getRowKey={(job) => job.id}
                            className="rounded-none border-0"
                        />
                    )}
                </Section>
            </div>

            {timezone ? (
                <JobFormSheet
                    mode="create"
                    open={createOpen}
                    roomId={roomId}
                    timezone={timezone}
                    onOpenChange={setCreateOpen}
                    initial={emptyJobForm()}
                    pending={createMutation.isPending}
                    onSubmit={(form) => createMutation.mutate(form)}
                />
            ) : null}

            {timezone ? (
                <JobFormSheet
                    mode="edit"
                    open={editJob !== null}
                    roomId={roomId}
                    timezone={editJob?.timezone ?? timezone}
                    onOpenChange={(open) => {
                        if (!open) setEditJob(null)
                    }}
                    initial={editJob ? jobToForm(editJob) : emptyJobForm()}
                    pending={editMutation.isPending}
                    onSubmit={(form) => {
                        if (editJob) editMutation.mutate({ previous: editJob, form })
                    }}
                />
            ) : null}

            <JobDetailSheet
                roomId={roomId}
                job={detailJob}
                usage={usageQuery.data ?? null}
                usageLoading={usageQuery.isLoading}
                onOpenChange={(open) => {
                    if (!open) setDetailJob(null)
                }}
            />

            <JobDeleteDialog
                jobName={deleteJob?.name ?? null}
                pending={removeMutation.isPending}
                onOpenChange={(open) => {
                    if (!open) setDeleteJob(null)
                }}
                onCancel={() => setDeleteJob(null)}
                onDelete={() => {
                    if (deleteJob) removeMutation.mutate(deleteJob.id)
                }}
            />
        </>
    )
}
