import type { RoomOnboardingRecord, RoomRecord, RoomRuntimeMetadataRecord } from '../domain/types'
import type { RoomSetupSnapshot } from './execution-types'

export function buildRoomSetupSnapshot(input: {
    room: RoomRecord
    runtimeMetadata: RoomRuntimeMetadataRecord | null
    onboarding: RoomOnboardingRecord | null
}): RoomSetupSnapshot {
    const onboardingStatus = input.onboarding?.status ?? null
    const onboardingSessionKey = input.onboarding?.sessionKey ?? null
    const completedAt = input.onboarding?.completedAt?.toISOString() ?? null
    const configurationBlocked =
        input.room.status === 'setup_required' ||
        input.runtimeMetadata?.lastError?.startsWith('Room configuration is blocked:') === true

    if (configurationBlocked) {
        return {
            phase: 'setup_required',
            onboardingStatus,
            onboardingSessionKey,
            canStartSessions: false,
            message:
                input.runtimeMetadata?.lastError ??
                'Room configuration must be completed before the runtime can start',
            completedAt,
        }
    }

    if (onboardingStatus === 'pending') {
        if (onboardingSessionKey) {
            return {
                phase: 'onboarding',
                onboardingStatus,
                onboardingSessionKey,
                canStartSessions: false,
                message: 'Complete the room intro before starting regular sessions',
                completedAt,
            }
        }

        return {
            phase: 'starting',
            onboardingStatus,
            onboardingSessionKey,
            canStartSessions: false,
            message: 'Room intro is waiting for the runtime to finish starting',
            completedAt,
        }
    }

    if (input.room.desiredState === 'running' && input.room.status === 'starting') {
        return {
            phase: 'starting',
            onboardingStatus,
            onboardingSessionKey,
            canStartSessions: false,
            message: 'Room runtime is starting',
            completedAt,
        }
    }

    return {
        phase: 'ready',
        onboardingStatus,
        onboardingSessionKey,
        canStartSessions: true,
        message: null,
        completedAt,
    }
}
