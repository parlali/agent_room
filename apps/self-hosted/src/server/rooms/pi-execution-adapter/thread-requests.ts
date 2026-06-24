import type { ThreadKind } from '../../pi-runtime/thread-records'
import type { RoomExecutionModelState, RoomExecutionThinkingLevel } from '../execution-types'
import { z } from 'zod'

export interface PiRuntimeThreadRequest {
    path: string
    method: 'POST' | 'DELETE'
    body?: unknown
}

function sessionPath(sessionKey: string, suffix = ''): string {
    return `/threads/${encodeURIComponent(sessionKey)}${suffix}`
}

function nonEmptyMessage(message: string): string {
    const trimmed = message.trim()
    if (!trimmed) {
        throw new Error('Message cannot be empty')
    }
    return trimmed
}

export const createThreadRuntimeBodySchema = z.object({
    firstMessage: z.string().nullable(),
    title: z.string().nullable(),
    hideUserMessage: z.boolean(),
    awaitInitialRun: z.boolean(),
    internalInstruction: z.string().nullable(),
    kind: z.enum(['main', 'subagent', 'deep_work', 'onboarding']),
})

export const sendThreadRuntimeBodySchema = z.object({
    message: z.string().trim().min(1, 'Message cannot be empty'),
    awaitCompletion: z.boolean(),
    runKind: z.enum(['manual', 'scheduled', 'subagent', 'maintenance']),
    hideUserMessage: z.boolean(),
    runId: z.string().min(1).nullable(),
    jobId: z.string().min(1).nullable().default(null),
})

export function createThreadRuntimeRequest(input: {
    firstMessage?: string | null
    title?: string | null
    hideUserMessage?: boolean
    awaitInitialRun?: boolean
    internalInstruction?: string | null
    kind?: ThreadKind
}): PiRuntimeThreadRequest {
    const body = createThreadRuntimeBodySchema.parse({
        firstMessage: input.firstMessage ?? null,
        title: input.title ?? null,
        hideUserMessage: input.hideUserMessage === true,
        awaitInitialRun: input.awaitInitialRun === true,
        internalInstruction: input.internalInstruction ?? null,
        kind: input.kind ?? 'main',
    })
    return {
        path: '/threads',
        method: 'POST',
        body,
    }
}

export function sendThreadRuntimeRequest(input: {
    sessionKey: string
    message: string
    awaitCompletion?: boolean
    runKind?: 'manual' | 'scheduled' | 'subagent' | 'maintenance'
    hideUserMessage?: boolean
    runId?: string | null
    jobId?: string | null
}): PiRuntimeThreadRequest {
    const body = sendThreadRuntimeBodySchema.parse({
        message: nonEmptyMessage(input.message),
        awaitCompletion: input.awaitCompletion === true,
        runKind: input.runKind ?? 'manual',
        hideUserMessage: input.hideUserMessage === true,
        runId: input.runId ?? null,
        jobId: input.jobId ?? null,
    })
    return {
        path: sessionPath(input.sessionKey, '/send'),
        method: 'POST',
        body,
    }
}

export function updateThreadModelRuntimeRequest(input: {
    sessionKey: string
    provider: string
    model: string
    thinkingLevel?: RoomExecutionThinkingLevel | null
    speedMode?: RoomExecutionModelState['speedMode']
}): PiRuntimeThreadRequest {
    return {
        path: sessionPath(input.sessionKey, '/model'),
        method: 'POST',
        body: {
            provider: input.provider,
            model: input.model,
            thinkingLevel: input.thinkingLevel ?? null,
            speedMode: input.speedMode ?? null,
        },
    }
}

export function abortThreadRuntimeRequest(input: {
    sessionKey: string
    runId?: string | null
}): PiRuntimeThreadRequest {
    return {
        path: sessionPath(input.sessionKey, '/abort'),
        method: 'POST',
        body: {
            runId: input.runId ?? null,
        },
    }
}

export function compactThreadRuntimeRequest(input: {
    sessionKey: string
    instructions?: string | null
}): PiRuntimeThreadRequest {
    return {
        path: sessionPath(input.sessionKey, '/compact'),
        method: 'POST',
        body: {
            instructions: input.instructions ?? null,
        },
    }
}

export function forkThreadRuntimeRequest(input: {
    sessionKey: string
    title?: string | null
    entryId?: string | null
}): PiRuntimeThreadRequest {
    return {
        path: sessionPath(input.sessionKey, '/fork'),
        method: 'POST',
        body: {
            title: input.title ?? null,
            entryId: input.entryId ?? null,
        },
    }
}

export function editThreadMessageRuntimeRequest(input: {
    sessionKey: string
    messageId: string
    message: string
}): PiRuntimeThreadRequest {
    return {
        path: sessionPath(
            input.sessionKey,
            `/messages/${encodeURIComponent(input.messageId)}/edit`,
        ),
        method: 'POST',
        body: {
            message: nonEmptyMessage(input.message),
            awaitCompletion: false,
        },
    }
}

export function deleteThreadRuntimeRequest(input: { sessionKey: string }): PiRuntimeThreadRequest {
    return {
        path: sessionPath(input.sessionKey),
        method: 'DELETE',
    }
}

export function renameThreadRuntimeRequest(input: {
    sessionKey: string
    title: string
}): PiRuntimeThreadRequest {
    return {
        path: sessionPath(input.sessionKey, '/rename'),
        method: 'POST',
        body: {
            title: input.title,
        },
    }
}
