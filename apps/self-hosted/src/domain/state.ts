import type { HealthStatus, RoomDesiredState, RoomStatus } from './domain-types'

export type Tone = 'ready' | 'working' | 'attention' | 'danger' | 'muted' | 'info'

export interface ToneStyle {
    dot: string
    chip: string
    text: string
}

export const toneStyles: Record<Tone, ToneStyle> = {
    ready: {
        dot: 'bg-ready',
        chip: 'bg-ready-soft text-ready-fg',
        text: 'text-ready-fg',
    },
    working: {
        dot: 'bg-working',
        chip: 'bg-working-soft text-working-fg',
        text: 'text-working-fg',
    },
    attention: {
        dot: 'bg-attention',
        chip: 'bg-attention-soft text-attention-fg',
        text: 'text-attention-fg',
    },
    danger: {
        dot: 'bg-danger',
        chip: 'bg-danger-soft text-danger-fg',
        text: 'text-danger-fg',
    },
    info: {
        dot: 'bg-info',
        chip: 'bg-info-soft text-info-fg',
        text: 'text-info-fg',
    },
    muted: {
        dot: 'bg-muted-foreground/40',
        chip: 'bg-muted text-muted-foreground',
        text: 'text-muted-foreground',
    },
}

export interface RoomDisplayState {
    label: string
    tone: Tone
}

export function describeRoomState(input: {
    status: RoomStatus
    desiredState: RoomDesiredState
    healthStatus: HealthStatus | null
}): RoomDisplayState {
    if (input.desiredState === 'stopped' && input.status !== 'starting') {
        return { label: 'Paused', tone: 'muted' }
    }
    switch (input.status) {
        case 'starting':
            return { label: 'Starting', tone: 'working' }
        case 'running':
            if (input.healthStatus === 'unhealthy') {
                return { label: 'Unhealthy', tone: 'attention' }
            }
            return { label: 'Ready', tone: 'ready' }
        case 'stopped':
            return { label: 'Paused', tone: 'muted' }
        case 'degraded':
            return { label: 'Degraded', tone: 'attention' }
        case 'failed':
            return { label: 'Failed', tone: 'danger' }
        case 'setup_required':
            return { label: 'Needs setup', tone: 'attention' }
    }
}

export interface SessionDisplayState {
    label: string
    tone: Tone
}

export function describeSessionState(status: string | null | undefined): SessionDisplayState {
    if (!status) return { label: 'Idle', tone: 'muted' }
    const lower = status.toLowerCase()
    if (lower.includes('error') || lower.includes('fail')) {
        return { label: 'Needs attention', tone: 'danger' }
    }
    if (
        lower.includes('compact') ||
        lower.includes('working') ||
        lower.includes('running') ||
        lower.includes('streaming') ||
        lower.includes('thinking')
    ) {
        return { label: lower.includes('compact') ? 'Compacting' : 'Working', tone: 'working' }
    }
    if (lower.includes('wait') || lower.includes('approval') || lower.includes('pending')) {
        return { label: 'Waiting', tone: 'attention' }
    }
    if (lower.includes('done') || lower.includes('complete') || lower.includes('idle')) {
        return { label: 'Done', tone: 'ready' }
    }
    if (lower.includes('paused') || lower.includes('stopped')) {
        return { label: 'Paused', tone: 'muted' }
    }
    return { label: status, tone: 'muted' }
}

export function describeJobLastRun(status: string | null | undefined): SessionDisplayState {
    if (!status) return { label: 'No runs yet', tone: 'muted' }
    const lower = status.toLowerCase()
    if (lower.includes('success') || lower.includes('ok') || lower.includes('complete'))
        return { label: 'Succeeded', tone: 'ready' }
    if (lower.includes('fail') || lower.includes('error'))
        return { label: 'Failed', tone: 'danger' }
    if (lower.includes('skip')) return { label: 'Skipped', tone: 'muted' }
    if (lower.includes('running') || lower.includes('start'))
        return { label: 'Running', tone: 'working' }
    return { label: status, tone: 'muted' }
}

export function describeProviderStatus(status: string | null | undefined): SessionDisplayState {
    if (!status) return { label: 'Not checked', tone: 'muted' }
    if (status === 'ready') return { label: 'Connected', tone: 'ready' }
    if (status === 'invalid') return { label: 'Invalid', tone: 'danger' }
    if (status === 'unchecked') return { label: 'Not checked', tone: 'muted' }
    return { label: status, tone: 'muted' }
}

export interface ScheduleSummary {
    label: string
    everyMinutes: number
}

export const schedulePresets: ScheduleSummary[] = [
    { label: 'Every 5 minutes', everyMinutes: 5 },
    { label: 'Every 15 minutes', everyMinutes: 15 },
    { label: 'Every 30 minutes', everyMinutes: 30 },
    { label: 'Every hour', everyMinutes: 60 },
    { label: 'Every 4 hours', everyMinutes: 240 },
    { label: 'Every day', everyMinutes: 24 * 60 },
    { label: 'Every week', everyMinutes: 7 * 24 * 60 },
]

export function describeSchedule(everyMinutes: number | null | undefined): string {
    if (everyMinutes === null || everyMinutes === undefined || everyMinutes <= 0) return 'Manual'
    const preset = schedulePresets.find((p) => p.everyMinutes === everyMinutes)
    if (preset) return preset.label
    if (everyMinutes < 60)
        return everyMinutes === 1 ? 'Every minute' : `Every ${everyMinutes} minutes`
    if (everyMinutes % (24 * 60) === 0) {
        const days = everyMinutes / (24 * 60)
        return days === 1 ? 'Every day' : `Every ${days} days`
    }
    if (everyMinutes % 60 === 0) {
        const hours = everyMinutes / 60
        return hours === 1 ? 'Every hour' : `Every ${hours} hours`
    }
    return `Every ${everyMinutes} minutes`
}
