import type { PiRuntimeCompactPayload, PiRuntimeForkPayload } from '../../pi-runtime/protocol'
import { usageRepository } from '../../db/repositories'
import type {
    RoomExecutionModelState,
    RoomExecutionThinkingLevel,
    RoomThreadAbortResult,
    RoomThreadSendResult,
} from '../execution-types'
import { requestPiRuntime } from '../pi-runtime-client'

import {
    abortSchema,
    compactSchema,
    createThreadSchema,
    forkSchema,
    sendSchema,
    sessionMutationSchema,
    threadModelSchema,
} from './runtime-schemas'
import { syncRuntimeUsageEvents } from './usage-sync'

export async function createRoomThread(input: {
    roomId: string
    firstMessage?: string | null
}): Promise<{ key: string }> {
    return requestPiRuntime(input.roomId, '/threads', createThreadSchema, {
        method: 'POST',
        body: {
            firstMessage: input.firstMessage ?? null,
        },
    })
}

export async function sendRoomThreadMessage(input: {
    roomId: string
    sessionKey: string
    message: string
    awaitCompletion?: boolean
    runKind?: 'manual' | 'scheduled' | 'subagent' | 'maintenance'
    jobId?: string | null
}): Promise<RoomThreadSendResult> {
    const message = input.message.trim()
    if (!message) {
        throw new Error('Message cannot be empty')
    }

    const startedAt = Date.now()
    try {
        const result = await requestPiRuntime(
            input.roomId,
            `/threads/${encodeURIComponent(input.sessionKey)}/send`,
            sendSchema,
            {
                method: 'POST',
                body: {
                    message,
                    awaitCompletion: input.awaitCompletion === true,
                    runKind: input.runKind ?? 'manual',
                },
            },
        )
        if (input.jobId && result.runId) {
            await syncRuntimeUsageEvents(input.roomId)
            await usageRepository.attachJobToRun({
                roomId: input.roomId,
                runId: result.runId,
                jobId: input.jobId,
            })
        }
        return result
    } catch (error) {
        await usageRepository.appendEvent({
            roomId: input.roomId,
            sessionKey: input.sessionKey,
            runId: null,
            jobId: input.jobId ?? null,
            kind: 'run',
            provider: null,
            model: null,
            toolName: null,
            inputTokens: null,
            outputTokens: null,
            cachedTokens: null,
            reasoningTokens: null,
            totalTokens: null,
            durationMs: Date.now() - startedAt,
            activeDurationMs: null,
            idleDurationMs: null,
            estimatedCostUsd: null,
            metadata: {
                status: 'failed',
                runKind: input.runKind ?? 'manual',
                error: error instanceof Error ? error.message : 'Unknown error',
                tokenUsageKnown: false,
            },
        })
        throw error
    }
}

export async function updateRoomThreadModel(input: {
    roomId: string
    sessionKey: string
    provider: string
    model: string
    thinkingLevel?: RoomExecutionThinkingLevel | null
    speedMode?: RoomExecutionModelState['speedMode']
}): Promise<RoomExecutionModelState> {
    return requestPiRuntime(
        input.roomId,
        `/threads/${encodeURIComponent(input.sessionKey)}/model`,
        threadModelSchema,
        {
            method: 'POST',
            body: {
                provider: input.provider,
                model: input.model,
                thinkingLevel: input.thinkingLevel ?? null,
                speedMode: input.speedMode ?? null,
            },
        },
    )
}

export async function abortRoomThreadMessage(input: {
    roomId: string
    sessionKey: string
    runId?: string | null
}): Promise<RoomThreadAbortResult> {
    return requestPiRuntime(
        input.roomId,
        `/threads/${encodeURIComponent(input.sessionKey)}/abort`,
        abortSchema,
        {
            method: 'POST',
            body: {
                runId: input.runId ?? null,
            },
        },
    )
}

export async function compactRoomThread(input: {
    roomId: string
    sessionKey: string
    instructions?: string | null
}): Promise<PiRuntimeCompactPayload> {
    return requestPiRuntime(
        input.roomId,
        `/threads/${encodeURIComponent(input.sessionKey)}/compact`,
        compactSchema,
        {
            method: 'POST',
            body: {
                instructions: input.instructions ?? null,
            },
        },
    )
}

export async function forkRoomThread(input: {
    roomId: string
    sessionKey: string
    title?: string | null
    entryId?: string | null
}): Promise<PiRuntimeForkPayload> {
    return requestPiRuntime(
        input.roomId,
        `/threads/${encodeURIComponent(input.sessionKey)}/fork`,
        forkSchema,
        {
            method: 'POST',
            body: {
                title: input.title ?? null,
                entryId: input.entryId ?? null,
            },
        },
    )
}

export async function editRoomThreadMessage(input: {
    roomId: string
    sessionKey: string
    messageId: string
    message: string
}): Promise<RoomThreadSendResult> {
    const message = input.message.trim()
    if (!message) {
        throw new Error('Message cannot be empty')
    }

    const startedAt = Date.now()
    try {
        const result = await requestPiRuntime(
            input.roomId,
            `/threads/${encodeURIComponent(input.sessionKey)}/messages/${encodeURIComponent(input.messageId)}/edit`,
            sendSchema,
            {
                method: 'POST',
                body: {
                    message,
                    awaitCompletion: false,
                },
            },
        )
        return result
    } catch (error) {
        await usageRepository.appendEvent({
            roomId: input.roomId,
            sessionKey: input.sessionKey,
            runId: null,
            jobId: null,
            kind: 'run',
            provider: null,
            model: null,
            toolName: null,
            inputTokens: null,
            outputTokens: null,
            cachedTokens: null,
            reasoningTokens: null,
            totalTokens: null,
            durationMs: Date.now() - startedAt,
            activeDurationMs: null,
            idleDurationMs: null,
            estimatedCostUsd: null,
            metadata: {
                status: 'failed',
                runKind: 'manual',
                error: error instanceof Error ? error.message : 'Unknown error',
                tokenUsageKnown: false,
                editedMessageId: input.messageId,
            },
        })
        throw error
    }
}

export async function deleteRoomSession(input: {
    roomId: string
    sessionKey: string
}): Promise<void> {
    await requestPiRuntime(
        input.roomId,
        `/threads/${encodeURIComponent(input.sessionKey)}`,
        sessionMutationSchema,
        { method: 'DELETE' },
    )
}

export async function renameRoomSession(input: {
    roomId: string
    sessionKey: string
    title: string
}): Promise<void> {
    await requestPiRuntime(
        input.roomId,
        `/threads/${encodeURIComponent(input.sessionKey)}/rename`,
        sessionMutationSchema,
        {
            method: 'POST',
            body: { title: input.title },
        },
    )
}
