import { cronRunStatuses } from '#/domain/domain-types'
import type { Tone } from '#/domain/state'

export type ScheduledTaskRunStatus = (typeof cronRunStatuses)[number]

export interface ScheduledTaskRunDisplay {
    label: string
    tone: Tone
}

const runStatusDisplay: Record<ScheduledTaskRunStatus, ScheduledTaskRunDisplay> = {
    running: { label: 'Running', tone: 'working' },
    complete: { label: 'Succeeded', tone: 'ready' },
    failed: { label: 'Failed', tone: 'danger' },
    skipped: { label: 'Skipped', tone: 'muted' },
}

export function toScheduledTaskRunStatus(
    status: string | null | undefined,
): ScheduledTaskRunStatus | null {
    if (status === null || status === undefined) return null
    return (cronRunStatuses as readonly string[]).includes(status)
        ? (status as ScheduledTaskRunStatus)
        : null
}

export function describeScheduledTaskLastRun(
    status: string | null | undefined,
): ScheduledTaskRunDisplay {
    if (status === null || status === undefined) {
        return { label: 'No runs yet', tone: 'muted' }
    }
    const canonical = toScheduledTaskRunStatus(status)
    if (canonical === null) {
        return { label: 'Unknown', tone: 'muted' }
    }
    return runStatusDisplay[canonical]
}

export function isScheduledTaskFailure(status: string | null | undefined): boolean {
    return toScheduledTaskRunStatus(status) === 'failed'
}
