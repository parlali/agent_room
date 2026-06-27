import { defaultJobSchedule, normalizeJobSchedule, type JobSchedule } from '#/domain/job-schedule'
import { sanitizeRuntimeError } from '#/domain/runtime-error'
import type { RoomCronJob } from '#/domain/room-execution-types'

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
    return sanitizeRuntimeError(error instanceof Error ? error.message : '')
}
