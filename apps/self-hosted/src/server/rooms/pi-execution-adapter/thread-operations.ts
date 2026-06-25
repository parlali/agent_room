import type { PiRuntimeCompactPayload, PiRuntimeForkPayload } from '../../pi-runtime/protocol'
import type { ThreadKind } from '../../pi-runtime/thread-records'
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
import {
    abortThreadRuntimeRequest,
    compactThreadRuntimeRequest,
    createThreadRuntimeRequest,
    deleteThreadRuntimeRequest,
    editThreadMessageRuntimeRequest,
    forkThreadRuntimeRequest,
    renameThreadRuntimeRequest,
    sendThreadRuntimeRequest,
    updateThreadModelRuntimeRequest,
} from './thread-requests'

export async function createRoomThread(input: {
    roomId: string
    firstMessage?: string | null
    title?: string | null
    hideUserMessage?: boolean
    awaitInitialRun?: boolean
    internalInstruction?: string | null
    kind?: ThreadKind
}): Promise<{ key: string }> {
    const request = createThreadRuntimeRequest(input)
    return requestPiRuntime(input.roomId, request.path, createThreadSchema, {
        method: request.method,
        body: request.body,
    })
}

export async function sendRoomThreadMessage(input: {
    roomId: string
    sessionKey: string
    message: string
    awaitCompletion?: boolean
    runKind?: 'manual' | 'scheduled' | 'subagent' | 'maintenance'
    jobId?: string | null
    hideUserMessage?: boolean
}): Promise<RoomThreadSendResult> {
    const request = sendThreadRuntimeRequest(input)
    const startedAt = Date.now()
    try {
        const result = await requestPiRuntime(input.roomId, request.path, sendSchema, {
            method: request.method,
            body: request.body,
        })
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
    const request = updateThreadModelRuntimeRequest(input)
    return requestPiRuntime(input.roomId, request.path, threadModelSchema, {
        method: request.method,
        body: request.body,
    })
}

export async function abortRoomThreadMessage(input: {
    roomId: string
    sessionKey: string
    runId?: string | null
}): Promise<RoomThreadAbortResult> {
    const request = abortThreadRuntimeRequest(input)
    return requestPiRuntime(input.roomId, request.path, abortSchema, {
        method: request.method,
        body: request.body,
    })
}

export async function compactRoomThread(input: {
    roomId: string
    sessionKey: string
    instructions?: string | null
}): Promise<PiRuntimeCompactPayload> {
    const request = compactThreadRuntimeRequest(input)
    return requestPiRuntime(input.roomId, request.path, compactSchema, {
        method: request.method,
        body: request.body,
    })
}

export async function forkRoomThread(input: {
    roomId: string
    sessionKey: string
    title?: string | null
    entryId?: string | null
}): Promise<PiRuntimeForkPayload> {
    const request = forkThreadRuntimeRequest(input)
    return requestPiRuntime(input.roomId, request.path, forkSchema, {
        method: request.method,
        body: request.body,
    })
}

export async function editRoomThreadMessage(input: {
    roomId: string
    sessionKey: string
    messageId: string
    message: string
}): Promise<RoomThreadSendResult> {
    const request = editThreadMessageRuntimeRequest(input)
    const startedAt = Date.now()
    try {
        const result = await requestPiRuntime(input.roomId, request.path, sendSchema, {
            method: request.method,
            body: request.body,
        })
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
    const request = deleteThreadRuntimeRequest(input)
    await requestPiRuntime(input.roomId, request.path, sessionMutationSchema, {
        method: request.method,
    })
}

export async function renameRoomSession(input: {
    roomId: string
    sessionKey: string
    title: string
}): Promise<void> {
    const request = renameThreadRuntimeRequest(input)
    await requestPiRuntime(input.roomId, request.path, sessionMutationSchema, {
        method: request.method,
        body: request.body,
    })
}
