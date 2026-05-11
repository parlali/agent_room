import { defaultJobSchedule, normalizeJobSchedule, type JobSchedule } from '#/lib/job-schedule'
import type { RoomCronJob } from '#/lib/room-execution-types'

export interface JobFormState {
    name: string
    message: string
    schedule: JobSchedule
}

export function emptyJobForm(): JobFormState {
    return { name: '', message: '', schedule: defaultJobSchedule }
}

export function jobToForm(job: RoomCronJob): JobFormState {
    return {
        name: job.name,
        message: job.payloadSummary ?? '',
        schedule: normalizeJobSchedule(job.schedule, job.everyMinutes),
    }
}

export function describeJobMutationError(error: unknown): string {
    return error instanceof Error ? error.message : 'Unexpected error'
}
