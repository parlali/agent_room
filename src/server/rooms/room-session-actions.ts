import { roomOnboardingRepository } from '../db/repositories'
import type { RoomThreadSendResult } from './execution-types'
import { createRoomThread, sendRoomThreadMessage } from './execution-engine'
import { scheduleOnboardingCompletionCheck, syncRoomOnboardingCompletion } from './room-onboarding'

export async function sendRoomSessionMessage(input: {
    roomId: string
    sessionKey: string
    message: string
}): Promise<RoomThreadSendResult> {
    await syncRoomOnboardingCompletion(input.roomId)
    const onboarding = await roomOnboardingRepository.findByRoomId(input.roomId)
    if (onboarding?.status === 'pending' && onboarding.sessionKey !== input.sessionKey) {
        throw new Error('Complete the room intro before continuing regular sessions')
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
        throw new Error('Complete the room intro before starting a new session')
    }
    return createRoomThread({
        roomId: input.roomId,
        firstMessage: input.firstMessage,
    })
}
