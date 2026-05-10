import { Link, createFileRoute } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { toast } from 'sonner'
import {
    CalendarClockIcon,
    Edit3Icon,
    FileTextIcon,
    Loader2Icon,
    PlayIcon,
    PlusIcon,
    Trash2Icon,
    XIcon,
} from 'lucide-react'

import { RoomDashboardLayout } from '#/components/room-dashboard'
import { EmptyState, LoadingRows, Section, StateBadge } from '#/components/agent-room'
import { Button } from '#/components/ui/button'
import { ButtonGroup } from '#/components/ui/button-group'
import { Input } from '#/components/ui/input'
import { Textarea } from '#/components/ui/textarea'
import { Label } from '#/components/ui/label'
import {
    Sheet,
    SheetContent,
    SheetDescription,
    SheetFooter,
    SheetHeader,
    SheetTitle,
} from '#/components/ui/sheet'
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '#/components/ui/select'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '#/components/ui/tooltip'
import { formatCostUsd, formatDurationMs, formatRelativeTime, formatTokens } from '#/lib/format'
import { describeJobLastRun } from '#/lib/state'
import {
    defaultJobSchedule,
    describeJobSchedule,
    normalizeJobSchedule,
    weekDays,
    type JobSchedule,
} from '#/lib/job-schedule'
import {
    createCronJobServer,
    listCronJobsServer,
    listRoomUsageServer,
    removeCronJobServer,
    runCronJobServer,
    setCronEnabledServer,
    updateCronJobServer,
} from '#/routes/-room-runtime-server'
import { requireRouteUser } from '#/routes/-route-auth'
import type { RoomCronJob } from '#/server/rooms/execution-types'
import type { UsageEventRecord } from '#/server/domain/types'
import { JobDeleteDialog } from './-jobs/delete-dialog'
import { JobListRow } from './-jobs/job-row'

export const Route = createFileRoute('/rooms/$roomId/jobs')({
    beforeLoad: requireRouteUser,
    component: RoomJobsPage,
})

interface JobFormState {
    name: string
    message: string
    schedule: JobSchedule
}

function emptyForm(): JobFormState {
    return { name: '', message: '', schedule: defaultJobSchedule }
}

function jobToForm(job: RoomCronJob): JobFormState {
    return {
        name: job.name,
        message: job.payloadSummary ?? '',
        schedule: normalizeJobSchedule(job.schedule, job.everyMinutes),
    }
}

function describeError(e: unknown): string {
    return e instanceof Error ? e.message : 'Unexpected error'
}

const scheduleTypes = [
    { value: 'interval', label: 'Interval' },
    { value: 'daily', label: 'Daily' },
    { value: 'weekly', label: 'Weekly' },
    { value: 'monthly', label: 'Monthly' },
] as const

const intervalUnits = [
    { value: 'minutes', label: 'Minutes' },
    { value: 'hours', label: 'Hours' },
    { value: 'days', label: 'Days' },
    { value: 'weeks', label: 'Weeks' },
] as const

type IntervalUnit = Extract<JobSchedule, { type: 'interval' }>['unit']

const groupedOptionClass =
    'relative h-8 rounded-md text-sm after:absolute after:inset-x-2 after:bottom-1 after:h-0.5 after:rounded-full after:bg-primary after:opacity-0 after:transition-opacity data-[active=true]:bg-background data-[active=true]:text-foreground data-[active=true]:shadow-sm data-[active=true]:after:opacity-100 dark:data-[active=true]:bg-input/50'

function scheduleForType(type: JobSchedule['type']): JobSchedule {
    if (type === 'interval') {
        return {
            type: 'interval',
            every: 1,
            unit: 'hours',
        }
    }
    if (type === 'weekly') {
        return {
            type: 'weekly',
            weekdays: [1],
            time: '09:00',
        }
    }
    if (type === 'monthly') {
        return {
            type: 'monthly',
            day: 1,
            time: '09:00',
        }
    }
    return defaultJobSchedule
}

function jobScheduleValid(schedule: JobSchedule): boolean {
    const normalized = normalizeJobSchedule(schedule)
    if (normalized.type === 'interval') return normalized.every > 0
    if (normalized.type === 'daily') return normalized.times.length > 0
    if (normalized.type === 'weekly') return normalized.weekdays.length > 0
    return normalized.day > 0
}

function RoomJobsPage() {
    const { roomId } = Route.useParams()
    const queryClient = useQueryClient()

    const jobsQuery = useQuery<RoomCronJob[]>({
        queryKey: ['room-cron-jobs', roomId],
        queryFn: () => listCronJobsServer({ data: { roomId } }),
        staleTime: 5_000,
        refetchInterval: 15_000,
    })

    const [createOpen, setCreateOpen] = useState(false)
    const [editJob, setEditJob] = useState<RoomCronJob | null>(null)
    const [deleteJob, setDeleteJob] = useState<RoomCronJob | null>(null)
    const [detailJob, setDetailJob] = useState<RoomCronJob | null>(null)
    const [pendingJobId, setPendingJobId] = useState<string | null>(null)

    const invalidate = () => queryClient.invalidateQueries({ queryKey: ['room-cron-jobs', roomId] })

    const createMutation = useMutation({
        mutationFn: (form: JobFormState) => createCronJobServer({ data: { roomId, ...form } }),
        onSuccess: async () => {
            await invalidate()
            toast.success('Job created')
            setCreateOpen(false)
        },
        onError: (e) => toast.error('Could not create job', { description: describeError(e) }),
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
            toast.success('Job updated')
            setEditJob(null)
        },
        onError: (e) => toast.error('Could not update job', { description: describeError(e) }),
    })

    const removeMutation = useMutation({
        mutationFn: (jobId: string) => removeCronJobServer({ data: { roomId, jobId } }),
        onSuccess: async () => {
            await invalidate()
            toast.success('Job deleted')
            setDeleteJob(null)
        },
        onError: (e) => toast.error('Could not delete job', { description: describeError(e) }),
    })

    const toggleMutation = useMutation({
        mutationFn: (input: { jobId: string; enabled: boolean }) =>
            setCronEnabledServer({ data: { roomId, ...input } }),
        onMutate: ({ jobId }) => setPendingJobId(jobId),
        onSuccess: async (_d, v) => {
            await invalidate()
            toast.success(v.enabled ? 'Job enabled' : 'Job disabled')
        },
        onError: (e) => toast.error('Could not update job', { description: describeError(e) }),
        onSettled: () => setPendingJobId(null),
    })

    const runMutation = useMutation({
        mutationFn: (jobId: string) => runCronJobServer({ data: { roomId, jobId } }),
        onMutate: (jobId) => setPendingJobId(jobId),
        onSuccess: async (result) => {
            await invalidate()
            if (result.ran) toast.success('Job started')
            else
                toast.message('Job not started', {
                    description: result.reason ?? 'No reason provided',
                })
        },
        onError: (e) => toast.error('Could not run job', { description: describeError(e) }),
        onSettled: () => setPendingJobId(null),
    })

    const jobs = jobsQuery.data ?? []
    const usageQuery = useQuery({
        queryKey: ['room-usage', roomId, 'jobs'],
        queryFn: () => listRoomUsageServer({ data: { roomId, limit: 200 } }),
        enabled: detailJob !== null,
        staleTime: 5_000,
    })
    const isLoading = jobsQuery.isLoading
    const isEmpty = !isLoading && jobs.length === 0

    return (
        <RoomDashboardLayout roomId={roomId} activeTab="jobs">
            <TooltipProvider>
                <div className="mx-auto flex max-w-5xl flex-col gap-6">
                    <Section
                        title="Jobs"
                        description="Schedule recurring work this room should do automatically."
                        actions={
                            <Button size="sm" onClick={() => setCreateOpen(true)}>
                                <PlusIcon />
                                New job
                            </Button>
                        }
                        bodyClassName={isLoading || isEmpty ? 'p-4' : 'p-0'}
                    >
                        {isLoading ? (
                            <LoadingRows count={3} />
                        ) : isEmpty ? (
                            <EmptyState
                                icon={CalendarClockIcon}
                                title="No jobs yet"
                                description="Schedule something for this room to do automatically."
                                action={
                                    <Button size="sm" onClick={() => setCreateOpen(true)}>
                                        <PlusIcon />
                                        Create a job
                                    </Button>
                                }
                            />
                        ) : (
                            <ul className="divide-y divide-border/60">
                                {jobs.map((job) => (
                                    <JobRow
                                        key={job.id}
                                        job={job}
                                        busy={pendingJobId === job.id}
                                        onToggle={(enabled) =>
                                            toggleMutation.mutate({ jobId: job.id, enabled })
                                        }
                                        onRun={() => runMutation.mutate(job.id)}
                                        onDetails={() => setDetailJob(job)}
                                        onEdit={() => setEditJob(job)}
                                        onDelete={() => setDeleteJob(job)}
                                    />
                                ))}
                            </ul>
                        )}
                    </Section>
                </div>
            </TooltipProvider>

            <JobFormSheet
                mode="create"
                open={createOpen}
                onOpenChange={setCreateOpen}
                initial={emptyForm()}
                pending={createMutation.isPending}
                onSubmit={(form) => createMutation.mutate(form)}
            />

            <JobFormSheet
                mode="edit"
                open={editJob !== null}
                onOpenChange={(open) => {
                    if (!open) setEditJob(null)
                }}
                initial={editJob ? jobToForm(editJob) : emptyForm()}
                pending={editMutation.isPending}
                onSubmit={(form) => {
                    if (editJob) editMutation.mutate({ previous: editJob, form })
                }}
            />

            <JobDetailSheet
                roomId={roomId}
                job={detailJob}
                usageEvents={(usageQuery.data?.events ?? []) as UsageEventRecord[]}
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
        </RoomDashboardLayout>
    )
}

function JobRow({
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

function JobDetailSheet({
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

function JobFormSheet({
    mode,
    open,
    onOpenChange,
    initial,
    pending,
    onSubmit,
}: {
    mode: 'create' | 'edit'
    open: boolean
    onOpenChange: (open: boolean) => void
    initial: JobFormState
    pending: boolean
    onSubmit: (form: JobFormState) => void
}) {
    return (
        <Sheet open={open} onOpenChange={onOpenChange}>
            <SheetContent className="flex w-full flex-col gap-0 sm:max-w-xl">
                <SheetHeader>
                    <SheetTitle>{mode === 'create' ? 'New job' : 'Edit job'}</SheetTitle>
                    <SheetDescription>
                        {mode === 'create'
                            ? 'Schedule recurring work for this room.'
                            : 'Update what this job does and when it runs.'}
                    </SheetDescription>
                </SheetHeader>
                <JobForm
                    key={`${mode}-${open ? 'open' : 'closed'}-${initial.name}`}
                    initial={initial}
                    pending={pending}
                    submitLabel={mode === 'create' ? 'Create job' : 'Save changes'}
                    onCancel={() => onOpenChange(false)}
                    onSubmit={onSubmit}
                />
            </SheetContent>
        </Sheet>
    )
}

function JobForm({
    initial,
    pending,
    submitLabel,
    onSubmit,
    onCancel,
}: {
    initial: JobFormState
    pending: boolean
    submitLabel: string
    onSubmit: (form: JobFormState) => void
    onCancel: () => void
}) {
    const [name, setName] = useState(initial.name)
    const [message, setMessage] = useState(initial.message)
    const [schedule, setSchedule] = useState<JobSchedule>(initial.schedule)

    const normalizedSchedule = normalizeJobSchedule(schedule)
    const valid =
        name.trim().length > 0 && message.trim().length > 0 && jobScheduleValid(normalizedSchedule)

    return (
        <form
            onSubmit={(e) => {
                e.preventDefault()
                if (!valid || pending) return
                onSubmit({
                    name: name.trim(),
                    message: message.trim(),
                    schedule: normalizedSchedule,
                })
            }}
            className="flex min-h-0 flex-1 flex-col"
        >
            <div className="flex-1 space-y-4 overflow-y-auto px-4 pb-4">
                <div className="space-y-1.5">
                    <Label htmlFor="job-name">Name</Label>
                    <Input
                        id="job-name"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        placeholder="Daily inbox sweep"
                        required
                        autoFocus
                    />
                </div>
                <div className="space-y-1.5">
                    <Label htmlFor="job-message">Instruction</Label>
                    <Textarea
                        id="job-message"
                        value={message}
                        onChange={(e) => setMessage(e.target.value)}
                        placeholder="Check for new tickets and summarize what changed."
                        rows={5}
                        required
                    />
                    <p className="text-xs text-muted-foreground">
                        Sent to the room as the first message when this job runs.
                    </p>
                </div>
                <div className="space-y-3">
                    <div className="space-y-1.5">
                        <Label>Schedule</Label>
                        <ButtonGroup className="w-full" aria-label="Schedule type">
                            {scheduleTypes.map((option) => (
                                <Button
                                    key={option.value}
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    data-active={schedule.type === option.value}
                                    aria-pressed={schedule.type === option.value}
                                    className={groupedOptionClass}
                                    onClick={() =>
                                        setSchedule(
                                            scheduleForType(option.value as JobSchedule['type']),
                                        )
                                    }
                                >
                                    {option.label}
                                </Button>
                            ))}
                        </ButtonGroup>
                    </div>

                    <ScheduleEditor schedule={schedule} onChange={setSchedule} />

                    <div className="rounded-md border border-border/60 bg-muted/30 p-3 text-sm text-muted-foreground">
                        <p className="font-medium text-foreground">
                            {describeJobSchedule(normalizedSchedule)}
                        </p>
                        <p className="mt-1">
                            Each run starts a new session in this room and sends the instruction
                            above to the agent.
                        </p>
                    </div>
                </div>
                <div className="rounded-md border border-border/60 p-3">
                    <div className="text-sm font-medium text-foreground">Run target</div>
                    <p className="mt-1 text-sm text-muted-foreground">
                        New session for each run. The session will keep the job name and runtime
                        usage tied back to this job.
                    </p>
                </div>
            </div>
            <SheetFooter className="border-t border-border/60">
                <div className="flex justify-end gap-2">
                    <Button type="button" variant="outline" onClick={onCancel} disabled={pending}>
                        Cancel
                    </Button>
                    <Button type="submit" disabled={!valid || pending}>
                        {pending ? <Loader2Icon className="animate-spin" /> : null}
                        {submitLabel}
                    </Button>
                </div>
            </SheetFooter>
        </form>
    )
}

function ScheduleEditor({
    schedule,
    onChange,
}: {
    schedule: JobSchedule
    onChange: (schedule: JobSchedule) => void
}) {
    if (schedule.type === 'interval') {
        return (
            <div className="grid grid-cols-[minmax(0,1fr)_9rem] gap-2">
                <div className="space-y-1.5">
                    <Label htmlFor="job-interval-every">Every</Label>
                    <Input
                        id="job-interval-every"
                        type="number"
                        min={1}
                        value={schedule.every}
                        onChange={(e) =>
                            onChange({
                                ...schedule,
                                every: Math.max(1, Number(e.target.value) || 1),
                            })
                        }
                    />
                </div>
                <div className="space-y-1.5">
                    <Label htmlFor="job-interval-unit">Unit</Label>
                    <Select
                        value={schedule.unit}
                        onValueChange={(unit) =>
                            onChange({
                                ...schedule,
                                unit: unit as IntervalUnit,
                            })
                        }
                    >
                        <SelectTrigger id="job-interval-unit" className="w-full">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            {intervalUnits.map((unit) => (
                                <SelectItem key={unit.value} value={unit.value}>
                                    {unit.label}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </div>
            </div>
        )
    }

    if (schedule.type === 'daily') {
        return (
            <div className="space-y-2">
                <Label>Times</Label>
                <div className="space-y-2">
                    {schedule.times.map((time, index) => (
                        <div key={`${time}-${index}`} className="flex items-center gap-2">
                            <Input
                                type="time"
                                value={time}
                                onChange={(e) => {
                                    const times = [...schedule.times]
                                    times[index] = e.target.value
                                    onChange({ ...schedule, times })
                                }}
                            />
                            <Button
                                type="button"
                                variant="ghost"
                                size="icon-sm"
                                disabled={schedule.times.length === 1}
                                onClick={() =>
                                    onChange({
                                        ...schedule,
                                        times: schedule.times.filter(
                                            (_, itemIndex) => itemIndex !== index,
                                        ),
                                    })
                                }
                                aria-label="Remove time"
                            >
                                <XIcon />
                            </Button>
                        </div>
                    ))}
                </div>
                <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={schedule.times.length >= 8}
                    onClick={() => onChange({ ...schedule, times: [...schedule.times, '09:00'] })}
                >
                    <PlusIcon />
                    Add time
                </Button>
            </div>
        )
    }

    if (schedule.type === 'weekly') {
        return (
            <div className="space-y-3">
                <div className="space-y-1.5">
                    <Label>Days</Label>
                    <ButtonGroup className="w-full" aria-label="Weekdays">
                        {weekDays.map((day) => (
                            <Button
                                key={day.value}
                                type="button"
                                variant="ghost"
                                size="sm"
                                data-active={schedule.weekdays.includes(day.value)}
                                aria-pressed={schedule.weekdays.includes(day.value)}
                                className={groupedOptionClass}
                                onClick={() => {
                                    const selected = schedule.weekdays.includes(day.value)
                                    if (selected && schedule.weekdays.length === 1) return
                                    onChange({
                                        ...schedule,
                                        weekdays: selected
                                            ? schedule.weekdays.filter(
                                                  (value) => value !== day.value,
                                              )
                                            : [...schedule.weekdays, day.value],
                                    })
                                }}
                            >
                                {day.short}
                            </Button>
                        ))}
                    </ButtonGroup>
                </div>
                <div className="space-y-1.5">
                    <Label htmlFor="job-weekly-time">Time</Label>
                    <Input
                        id="job-weekly-time"
                        type="time"
                        value={schedule.time}
                        onChange={(e) => onChange({ ...schedule, time: e.target.value })}
                    />
                </div>
            </div>
        )
    }

    return (
        <div className="grid grid-cols-[minmax(0,1fr)_9rem] gap-2">
            <div className="space-y-1.5">
                <Label htmlFor="job-monthly-day">Day of month</Label>
                <Input
                    id="job-monthly-day"
                    type="number"
                    min={1}
                    max={31}
                    value={schedule.day}
                    onChange={(e) =>
                        onChange({
                            ...schedule,
                            day: Math.min(31, Math.max(1, Number(e.target.value) || 1)),
                        })
                    }
                />
            </div>
            <div className="space-y-1.5">
                <Label htmlFor="job-monthly-time">Time</Label>
                <Input
                    id="job-monthly-time"
                    type="time"
                    value={schedule.time}
                    onChange={(e) => onChange({ ...schedule, time: e.target.value })}
                />
            </div>
        </div>
    )
}
