import { roomOnboardingRepository } from '../db/repositories'
import {
    isRoomOnboardingSkipMessage,
    onboardingDeferredStatus,
    onboardingRequiredToContinueSessionMessage,
    onboardingRequiredToStartSessionMessage,
} from '#/lib/room-onboarding-errors'
import type { RoomThreadSendResult } from './execution-types'
import { createRoomThread, sendRoomThreadMessage } from './execution-engine'
import {
    deferRoomOnboarding,
    scheduleOnboardingCompletionCheck,
    syncRoomOnboardingCompletion,
} from './room-onboarding'

export async function sendRoomSessionMessage(input: {
    roomId: string
    sessionKey: string
    message: string
}): Promise<RoomThreadSendResult> {
    await syncRoomOnboardingCompletion(input.roomId)
    const onboarding = await roomOnboardingRepository.findByRoomId(input.roomId)
    if (onboarding?.status === 'pending' && onboarding.sessionKey !== input.sessionKey) {
        if (onboarding.sessionKey) {
            scheduleOnboardingCompletionCheck({
                roomId: input.roomId,
                sessionKey: onboarding.sessionKey,
                runId: null,
            })
        }
        throw new Error(onboardingRequiredToContinueSessionMessage)
    }
    if (
        onboarding?.status === 'pending' &&
        onboarding.sessionKey === input.sessionKey &&
        isRoomOnboardingSkipMessage(input.message)
    ) {
        await deferRoomOnboarding({
            roomId: input.roomId,
            sessionKey: input.sessionKey,
            source: 'operator_message',
        })
        return {
            runId: null,
            status: onboardingDeferredStatus,
            messageSeq: null,
            interruptedActiveRun: false,
            error: null,
        }
    }
    const isOnboardingReply = onboarding?.status === 'pending'
    const result = await sendRoomThreadMessage({
        roomId: input.roomId,
        sessionKey: input.sessionKey,
        message: input.message,
        awaitCompletion: false,
    })
    if (isOnboardingReply) {
        scheduleOnboardingCompletionCheck({
            roomId: input.roomId,
            sessionKey: input.sessionKey,
            runId: result.runId,
        })
    }
    return result
}

export async function createRegularRoomThread(input: {
    roomId: string
    firstMessage?: string | null
}): Promise<{ key: string }> {
    await syncRoomOnboardingCompletion(input.roomId)
    const onboarding = await roomOnboardingRepository.findByRoomId(input.roomId)
    if (onboarding?.status === 'pending') {
        if (onboarding.sessionKey) {
            scheduleOnboardingCompletionCheck({
                roomId: input.roomId,
                sessionKey: onboarding.sessionKey,
                runId: null,
            })
        }
        throw new Error(onboardingRequiredToStartSessionMessage)
    }
    return createRoomThread({
        roomId: input.roomId,
        firstMessage: input.firstMessage,
    })
}
