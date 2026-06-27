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
    if (!(error instanceof Error)) return 'Unexpected error'

    const message = error.message.trim()
    if (!message) return 'Unexpected error'
    const safeMessage = sanitizeRuntimeError(message)
    return safeMessage === message ? safeMessage : 'Unexpected error'
}
