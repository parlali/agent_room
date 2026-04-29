import { createFileRoute } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import {
    CalendarClockIcon,
    ClockIcon,
    Edit3Icon,
    Loader2Icon,
    PlayIcon,
    PlusIcon,
    Trash2Icon,
} from 'lucide-react'

import { RoomDashboardLayout } from '#/components/room-dashboard'
import { EmptyState, LoadingRows, Section, StateBadge, StatusDot } from '#/components/agent-room'
import { Button } from '#/components/ui/button'
import { Input } from '#/components/ui/input'
import { Textarea } from '#/components/ui/textarea'
import { Label } from '#/components/ui/label'
import { Switch } from '#/components/ui/switch'
import {
    Sheet,
    SheetContent,
    SheetDescription,
    SheetFooter,
    SheetHeader,
    SheetTitle,
} from '#/components/ui/sheet'
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '#/components/ui/dialog'
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '#/components/ui/select'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '#/components/ui/tooltip'
import { formatDurationMs, formatRelativeTime } from '#/lib/format'
import { describeJobLastRun, describeSchedule, schedulePresets } from '#/lib/state'
import {
    createCronJobServer,
    listCronJobsServer,
    removeCronJobServer,
    runCronJobServer,
    setCronEnabledServer,
} from '#/routes/-room-runtime-server'
import { requireRouteUser } from '#/routes/-route-auth'
import type { RoomCronJob } from '#/server/rooms/execution-types'

export const Route = createFileRoute('/rooms/$roomId/jobs')({
    beforeLoad: requireRouteUser,
    component: RoomJobsPage,
})

interface JobFormState {
    name: string
    message: string
    everyMinutes: number
}

const DEFAULT_PRESET = schedulePresets[2] ?? schedulePresets[0]!

function emptyForm(): JobFormState {
    return { name: '', message: '', everyMinutes: DEFAULT_PRESET.everyMinutes }
}

function inferEveryMinutes(job: RoomCronJob): number {
    const summary = job.scheduleSummary?.toLowerCase() ?? ''
    const preset = schedulePresets.find((p) => summary === p.label.toLowerCase())
    return preset ? preset.everyMinutes : DEFAULT_PRESET.everyMinutes
}

function jobToForm(job: RoomCronJob): JobFormState {
    return {
        name: job.name,
        message: job.payloadSummary ?? '',
        everyMinutes: inferEveryMinutes(job),
    }
}

function describeError(e: unknown): string {
    return e instanceof Error ? e.message : 'Unexpected error'
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
            await removeCronJobServer({ data: { roomId, jobId: input.previous.id } })
            return createCronJobServer({ data: { roomId, ...input.form } })
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

            <Dialog
                open={deleteJob !== null}
                onOpenChange={(open) => {
                    if (!open) setDeleteJob(null)
                }}
            >
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Delete this job?</DialogTitle>
                        <DialogDescription>
                            {deleteJob
                                ? `"${deleteJob.name}" will stop running. This cannot be undone.`
                                : null}
                        </DialogDescription>
                    </DialogHeader>
                    <DialogFooter>
                        <Button
                            variant="outline"
                            onClick={() => setDeleteJob(null)}
                            disabled={removeMutation.isPending}
                        >
                            Cancel
                        </Button>
                        <Button
                            variant="destructive"
                            onClick={() => {
                                if (deleteJob) removeMutation.mutate(deleteJob.id)
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
        </RoomDashboardLayout>
    )
}

function JobRow({
    job,
    busy,
    onToggle,
    onRun,
    onEdit,
    onDelete,
}: {
    job: RoomCronJob
    busy: boolean
    onToggle: (enabled: boolean) => void
    onRun: () => void
    onEdit: () => void
    onDelete: () => void
}) {
    const last = describeJobLastRun(job.lastRunStatus)
    const schedule = job.scheduleSummary || describeSchedule(inferEveryMinutes(job))
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
                    {job.lastDurationMs ? (
                        <span>Last took {formatDurationMs(job.lastDurationMs)}</span>
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
            </div>
        </li>
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
            <SheetContent className="flex w-full flex-col gap-0 sm:max-w-md">
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
    const [everyMinutes, setEveryMinutes] = useState(initial.everyMinutes)

    const presetOptions = useMemo(() => {
        const known = schedulePresets.some((p) => p.everyMinutes === everyMinutes)
        if (known) return schedulePresets
        return [...schedulePresets, { label: describeSchedule(everyMinutes), everyMinutes }]
    }, [everyMinutes])

    const valid = name.trim().length > 0 && message.trim().length > 0 && everyMinutes > 0

    return (
        <form
            onSubmit={(e) => {
                e.preventDefault()
                if (!valid || pending) return
                onSubmit({ name: name.trim(), message: message.trim(), everyMinutes })
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
                    <Label htmlFor="job-message">What should this room do?</Label>
                    <Textarea
                        id="job-message"
                        value={message}
                        onChange={(e) => setMessage(e.target.value)}
                        placeholder="Check for new tickets and summarize what changed."
                        rows={5}
                        required
                    />
                    <p className="text-xs text-muted-foreground">
                        Sent to the room each time the job fires.
                    </p>
                </div>
                <div className="space-y-1.5">
                    <Label htmlFor="job-schedule">When should it happen?</Label>
                    <Select
                        value={String(everyMinutes)}
                        onValueChange={(v) => setEveryMinutes(Number(v))}
                    >
                        <SelectTrigger id="job-schedule" className="w-full">
                            <SelectValue placeholder="Pick a schedule" />
                        </SelectTrigger>
                        <SelectContent>
                            {presetOptions.map((preset) => (
                                <SelectItem
                                    key={preset.everyMinutes}
                                    value={String(preset.everyMinutes)}
                                >
                                    {preset.label}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
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
