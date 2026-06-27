import { GlobeIcon, KeyRoundIcon, SparklesIcon } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

import { sanitizeRuntimeError } from '#/domain/runtime-error'
import { describeRoomState, type Tone } from '#/domain/state'
import type { RoomRuntimeOverview, RoomSetupSnapshot } from '#/domain/room-execution-types'
import type { RoomConfigSnapshot } from '#/server/configuration/operator-configuration'

export interface RoomReadinessCheck {
    icon: LucideIcon
    tone: Tone
    label: string
    detail: string
}

export interface RoomReadiness {
    tone: Tone
    label: string
    checks: RoomReadinessCheck[]
}

const TONE_SEVERITY: Record<Tone, number> = {
    ready: 0,
    info: 1,
    muted: 2,
    working: 3,
    attention: 4,
    danger: 5,
}

export function roomNeedsSetup(input: {
    setup: Pick<RoomSetupSnapshot, 'phase'>
    room: Pick<RoomRuntimeOverview, 'status'>
}): boolean {
    return input.setup.phase === 'setup_required' || input.room.status === 'setup_required'
}

export function buildRoomReadiness(input: {
    room: Pick<RoomRuntimeOverview, 'status' | 'desiredState' | 'healthStatus'>
    setup: RoomSetupSnapshot
    config: RoomConfigSnapshot | null
}): RoomReadiness {
    const checks = buildRoomReadinessChecks({ setup: input.setup, config: input.config })
    const summary = summarizeReadiness(input.room, checks)
    return { tone: summary.tone, label: summary.label, checks }
}

function summarizeReadiness(
    room: Pick<RoomRuntimeOverview, 'status' | 'desiredState' | 'healthStatus'>,
    checks: RoomReadinessCheck[],
): { tone: Tone; label: string } {
    const runtime = describeRoomState({
        status: room.status,
        desiredState: room.desiredState,
        healthStatus: room.healthStatus,
    })
    if (runtime.kind === 'paused' || runtime.kind === 'starting' || runtime.kind === 'failed') {
        return { tone: runtime.tone, label: runtime.label }
    }
    const worst = checks.reduce<Tone>(
        (acc, check) => (TONE_SEVERITY[check.tone] > TONE_SEVERITY[acc] ? check.tone : acc),
        'ready',
    )
    if (worst === 'attention' || worst === 'danger') {
        return { tone: 'attention', label: 'Needs setup' }
    }
    if (worst === 'working') {
        return { tone: 'working', label: 'Getting ready' }
    }
    if (worst === 'muted') {
        return { tone: 'muted', label: 'Checking setup' }
    }
    return { tone: 'ready', label: 'Ready' }
}

function buildRoomReadinessChecks(input: {
    setup: RoomSetupSnapshot
    config: RoomConfigSnapshot | null
}): RoomReadinessCheck[] {
    const checks: RoomReadinessCheck[] = [modelCheck(input.config), conversationsCheck(input.setup)]
    const web = webAccessCheck(input.config)
    if (web) checks.push(web)
    return checks
}

function modelCheck(config: RoomConfigSnapshot | null): RoomReadinessCheck {
    if (!config) {
        return {
            icon: KeyRoundIcon,
            tone: 'muted',
            label: 'Model',
            detail: 'Checking the model connection.',
        }
    }
    if (config.effective.ready) {
        return {
            icon: KeyRoundIcon,
            tone: 'ready',
            label: 'Model',
            detail: 'Connected and ready to respond.',
        }
    }
    return {
        icon: KeyRoundIcon,
        tone: 'attention',
        label: 'Model',
        detail: 'Connect a model so this room can work.',
    }
}

function conversationsCheck(setup: RoomSetupSnapshot): RoomReadinessCheck {
    if (setup.phase === 'ready') {
        return {
            icon: SparklesIcon,
            tone: 'ready',
            label: 'Conversations',
            detail: 'Ready to chat and run tasks.',
        }
    }
    if (setup.phase === 'starting' || setup.phase === 'onboarding') {
        return {
            icon: SparklesIcon,
            tone: 'working',
            label: 'Conversations',
            detail: 'Getting this room ready.',
        }
    }
    return {
        icon: SparklesIcon,
        tone: 'attention',
        label: 'Conversations',
        detail: setup.message
            ? sanitizeRuntimeError(setup.message)
            : 'Finish setup to enable conversations.',
    }
}

function webAccessCheck(config: RoomConfigSnapshot | null): RoomReadinessCheck | null {
    if (!config || !config.effective.capabilities.webSearch) return null
    if (config.effective.searchReady) {
        return {
            icon: GlobeIcon,
            tone: 'ready',
            label: 'Web access',
            detail: 'Web access is on and ready.',
        }
    }
    return {
        icon: GlobeIcon,
        tone: 'attention',
        label: 'Web access',
        detail: 'Web access is on but not ready yet.',
    }
}
