import { GlobeIcon, KeyRoundIcon, SparklesIcon } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

import type { Tone } from '#/domain/state'
import type { RoomSetupSnapshot } from '#/domain/room-execution-types'
import type { RoomConfigSnapshot } from '#/server/configuration/operator-configuration'

export interface RoomReadinessCheck {
    icon: LucideIcon
    tone: Tone
    label: string
    detail: string
}

export function buildRoomReadinessChecks(input: {
    setup: RoomSetupSnapshot
    config: RoomConfigSnapshot | null
}): RoomReadinessCheck[] {
    const checks: RoomReadinessCheck[] = [
        modelCheck(input.config),
        conversationsCheck(input.setup),
    ]
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
        detail: setup.message ?? 'Finish setup to enable conversations.',
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
