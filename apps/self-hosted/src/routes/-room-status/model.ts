import { CalendarClockIcon, FolderIcon, KeyRoundIcon, SparklesIcon } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

import { CAPABILITY_OPTIONS } from '#/domain/capabilities'
import { describeJobLastRun, describeSessionState, type Tone } from '#/domain/state'
import type {
    RoomCronJob,
    RoomExecutionSnapshot,
    RoomRunHistoryEntry,
} from '#/domain/room-execution-types'
import type { RoomConfigSnapshot } from '#/server/configuration/operator-configuration'
import type { RoomSetupReadinessSnapshot } from '#/server/rooms/runtime-readiness'

const ONE_HOUR_MS = 60 * 60 * 1000

export type OverallTone = 'ready' | 'working' | 'attention' | 'danger'
export type FixTo = '/rooms/$roomId/settings' | '/rooms/$roomId/jobs'

export interface OverallStatus {
    tone: OverallTone
    label: string
    description: string
}

export interface CheckRow {
    icon: LucideIcon
    tone: Tone
    label: string
    detail: string
    fixTo?: FixTo
    fixLabel?: string
}

export function classifyRun(status: string | null) {
    return describeJobLastRun(status)
}

export function isFailed(entry: RoomRunHistoryEntry) {
    return classifyRun(entry.status).tone === 'danger'
}

export function isSucceeded(entry: RoomRunHistoryEntry) {
    return classifyRun(entry.status).tone === 'ready'
}

export function buildOverall(input: {
    execution: RoomExecutionSnapshot | null
    config: RoomConfigSnapshot | null
    readiness: RoomSetupReadinessSnapshot | null
    history: RoomRunHistoryEntry[]
}): OverallStatus {
    const { execution, config, readiness, history } = input
    const room = execution?.room ?? null
    if (room?.status === 'setup_required') {
        const blockedReason = config?.effective.blockedReasons[0] ?? null
        return {
            tone: 'attention',
            label: 'Needs setup',
            description:
                blockedReason ?? 'Add room-scoped provider configuration to start this room.',
        }
    }

    if (room?.status === 'failed' || execution?.executionState === 'error') {
        return {
            tone: 'danger',
            label: 'Failed',
            description:
                room?.lastError ?? execution?.executionMessage ?? 'This room could not start.',
        }
    }

    const blocking = readiness?.issues.find((issue) => issue.severity === 'blocking') ?? null
    if (blocking) {
        return { tone: 'attention', label: 'Needs attention', description: blocking.message }
    }

    const blockedReason = config?.effective.blockedReasons[0] ?? null
    if (blockedReason && !config?.effective.ready) {
        return { tone: 'attention', label: 'Needs attention', description: blockedReason }
    }

    const capabilityIssue = capabilityBlockers(config)[0] ?? null
    if (capabilityIssue) {
        return { tone: 'attention', label: 'Needs attention', description: capabilityIssue }
    }

    if (room?.desiredState === 'stopped') {
        return {
            tone: 'attention',
            label: 'Paused',
            description:
                'This room is paused. Resume from the room header to run jobs and sessions.',
        }
    }

    if (room?.lastError) {
        return { tone: 'attention', label: 'Needs attention', description: room.lastError }
    }

    const recent = history.find((entry) => isFailed(entry) && Date.now() - entry.ts <= ONE_HOUR_MS)
    if (recent) {
        return {
            tone: 'attention',
            label: 'Needs attention',
            description:
                recent.error ??
                recent.summary ??
                `Last run of ${recent.jobName ?? 'a session'} failed.`,
        }
    }

    if (room?.status === 'starting') {
        return {
            tone: 'working',
            label: 'Working on something',
            description: 'The room is starting up.',
        }
    }

    const working = execution?.threads.find(
        (thread) => describeSessionState(thread.status).tone === 'working',
    )
    if (working) {
        return {
            tone: 'working',
            label: 'Working on something',
            description: working.title
                ? `Active session: ${working.title}`
                : 'A session is running right now.',
        }
    }

    if (room?.status === 'running') {
        return {
            tone: 'ready',
            label: 'Ready',
            description: 'Everything in this room is ready to run.',
        }
    }

    return {
        tone: 'attention',
        label: 'Needs attention',
        description: execution?.executionMessage ?? 'This room is not currently reachable.',
    }
}

export function buildStatusChecks(input: {
    config: RoomConfigSnapshot | null
    readiness: RoomSetupReadinessSnapshot | null
    jobs: RoomCronJob[]
    history: RoomRunHistoryEntry[]
}): CheckRow[] {
    const { config, readiness, jobs, history } = input
    return [
        modelConnectionRow(config),
        capabilitiesRow(config),
        jobsRow(jobs, history),
        {
            icon: FolderIcon,
            tone: 'ready',
            label: 'Files',
            detail: 'File workspace is available.',
        },
        setupRow(readiness),
    ]
}

function capabilityBlockers(config: RoomConfigSnapshot | null): string[] {
    if (!config) {
        return []
    }

    const blockers: string[] = []
    if (config.effective.capabilities.webSearch && !config.effective.searchReady) {
        blockers.push('Web search is enabled but the search backend is not ready.')
    }
    if (config.effective.capabilities.images && !config.effective.imageReady) {
        blockers.push('Images are enabled but provider, model, or room image key is missing.')
    }
    return blockers
}

function modelConnectionRow(config: RoomConfigSnapshot | null): CheckRow {
    if (!config) {
        return {
            icon: KeyRoundIcon,
            tone: 'muted',
            label: 'Model connection',
            detail: 'Loading model status.',
        }
    }

    if (config.effective.ready) {
        const label = config.effective.providerLabel ?? config.effective.provider ?? 'Default model'
        const model = config.effective.model
        return {
            icon: KeyRoundIcon,
            tone: 'ready',
            label: 'Model connection',
            detail: model ? `Connected to ${label} (${model}).` : `Connected to ${label}.`,
        }
    }

    const reason = config.effective.blockedReasons[0]
    const isMissing = config.effective.providerSource === 'missing'
    return {
        icon: KeyRoundIcon,
        tone: isMissing ? 'danger' : 'attention',
        label: 'Model connection',
        detail:
            reason ??
            (isMissing
                ? 'No model is connected to this room.'
                : 'Model needs a key or finishing setup.'),
        fixTo: '/rooms/$roomId/settings',
        fixLabel: isMissing ? 'Connect' : 'Fix',
    }
}

function jobsRow(jobs: RoomCronJob[], history: RoomRunHistoryEntry[]): CheckRow {
    const enabled = jobs.filter((job) => job.enabled)
    const lastJobRun = history.find((entry) => entry.jobId)
    if (jobs.length === 0) {
        return {
            icon: CalendarClockIcon,
            tone: 'muted',
            label: 'Jobs',
            detail: 'No scheduled jobs yet.',
        }
    }

    if (enabled.length === 0) {
        return {
            icon: CalendarClockIcon,
            tone: 'muted',
            label: 'Jobs',
            detail: 'All jobs are paused.',
            fixTo: '/rooms/$roomId/jobs',
            fixLabel: 'Open jobs',
        }
    }

    if (lastJobRun && isFailed(lastJobRun)) {
        return {
            icon: CalendarClockIcon,
            tone: 'attention',
            label: 'Jobs',
            detail:
                lastJobRun.error ??
                lastJobRun.summary ??
                `Last run of ${lastJobRun.jobName ?? 'a job'} failed.`,
            fixTo: '/rooms/$roomId/jobs',
        }
    }

    return {
        icon: CalendarClockIcon,
        tone: 'ready',
        label: 'Jobs',
        detail: `${enabled.length} ${enabled.length === 1 ? 'job is' : 'jobs are'} scheduled and running normally.`,
    }
}

function setupRow(readiness: RoomSetupReadinessSnapshot | null): CheckRow {
    if (!readiness) {
        return {
            icon: SparklesIcon,
            tone: 'muted',
            label: 'Room setup',
            detail: 'Loading setup status.',
        }
    }

    if (!readiness.hasBlockingIssues) {
        return {
            icon: SparklesIcon,
            tone: 'ready',
            label: 'Room setup',
            detail: 'All setup checks pass.',
        }
    }

    const blocking = readiness.issues.filter((issue) => issue.severity === 'blocking')
    return {
        icon: SparklesIcon,
        tone: 'attention',
        label: 'Room setup',
        detail:
            blocking.length === 1
                ? blocking[0]!.message
                : `${blocking.length} setup issues need attention. First: ${blocking[0]!.message}`,
        fixTo: '/rooms/$roomId/settings',
    }
}

function capabilitiesRow(config: RoomConfigSnapshot | null): CheckRow {
    if (!config) {
        return {
            icon: SparklesIcon,
            tone: 'muted',
            label: 'Capabilities',
            detail: 'Loading capability status.',
        }
    }

    const enabled = CAPABILITY_OPTIONS.filter((option) => config.effective.capabilities[option.key])
    const blockers = capabilityBlockers(config)
    if (blockers.length > 0) {
        return {
            icon: SparklesIcon,
            tone: 'attention',
            label: 'Capabilities',
            detail: blockers[0]!,
        }
    }

    return {
        icon: SparklesIcon,
        tone: 'ready',
        label: 'Capabilities',
        detail:
            enabled.length === 0
                ? 'No optional capabilities are enabled.'
                : `${enabled.length} capabilities enabled: ${enabled
                      .slice(0, 4)
                      .map((option) => option.label)
                      .join(', ')}${enabled.length > 4 ? ', and more' : ''}.`,
    }
}
