import { createFileRoute } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { toast } from 'sonner'
import { CalendarClockIcon, PlusIcon } from 'lucide-react'

import { RoomDashboardLayout } from '#/components/room-dashboard'
import { EmptyState, LoadingRows, Section } from '#/components/agent-room'
import { Button } from '#/components/ui/button'
import { TooltipProvider } from '#/components/ui/tooltip'
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
import type { RoomCronJob } from '#/lib/room-execution-types'
import type { UsageEventRecord } from '#/lib/domain-types'
import { JobDeleteDialog } from './-jobs/delete-dialog'
import { JobDetailSheet } from './-jobs/detail-sheet'
import { JobFormSheet } from './-jobs/form-sheet'
import { describeJobMutationError, emptyJobForm, jobToForm, type JobFormState } from './-jobs/model'
import { JobRow } from './-jobs/row-actions'

export const Route = createFileRoute('/rooms/$roomId/jobs')({
    beforeLoad: requireRouteUser,
    component: RoomJobsPage,
})

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
        onError: (e) =>
            toast.error('Could not create job', { description: describeJobMutationError(e) }),
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
        onError: (e) =>
            toast.error('Could not update job', { description: describeJobMutationError(e) }),
    })

    const removeMutation = useMutation({
        mutationFn: (jobId: string) => removeCronJobServer({ data: { roomId, jobId } }),
        onSuccess: async () => {
            await invalidate()
            toast.success('Job deleted')
            setDeleteJob(null)
        },
        onError: (e) =>
            toast.error('Could not delete job', { description: describeJobMutationError(e) }),
    })

    const toggleMutation = useMutation({
        mutationFn: (input: { jobId: string; enabled: boolean }) =>
            setCronEnabledServer({ data: { roomId, ...input } }),
        onMutate: ({ jobId }) => setPendingJobId(jobId),
        onSuccess: async (_d, v) => {
            await invalidate()
            toast.success(v.enabled ? 'Job enabled' : 'Job disabled')
        },
        onError: (e) =>
            toast.error('Could not update job', { description: describeJobMutationError(e) }),
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
        onError: (e) =>
            toast.error('Could not run job', { description: describeJobMutationError(e) }),
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
                initial={emptyJobForm()}
                pending={createMutation.isPending}
                onSubmit={(form) => createMutation.mutate(form)}
            />

            <JobFormSheet
                mode="edit"
                open={editJob !== null}
                onOpenChange={(open) => {
                    if (!open) setEditJob(null)
                }}
                initial={editJob ? jobToForm(editJob) : emptyJobForm()}
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
