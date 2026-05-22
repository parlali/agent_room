import { describe, expect, it } from 'vitest'
import type { AgentSessionEvent } from '@mariozechner/pi-coding-agent'
import type { ThreadRecord } from './thread-records'
import { removeDeliveredPendingUserMessage } from './pending-user-messages'

describe('pending user message delivery', () => {
    it('removes the pending message for the active run and annotates the delivered event', () => {
        const record = threadRecord({
            activeRunId: 'run-two',
            pendingUserMessages: [
                {
                    messageId: 'message-one',
                    runId: 'run-one',
                    runKind: 'manual',
                    text: 'First',
                    queuedAt: 1,
                },
                {
                    messageId: 'message-two',
                    runId: 'run-two',
                    runKind: 'manual',
                    text: 'Second',
                    queuedAt: 2,
                },
            ],
        })

        const result = removeDeliveredPendingUserMessage(
            record,
            userMessageEndEvent('Delivered text with provider-side normalization'),
        )

        expect(result.changed).toBe(true)
        expect(record.pendingUserMessages?.map((message) => message.messageId)).toEqual([
            'message-one',
        ])
        expect((result.event as { message: { messageId?: string } }).message.messageId).toBe(
            'message-two',
        )
    })

    it('fails closed when a delivered message cannot be tied to a pending message id', () => {
        const record = threadRecord({
            activeRunId: null,
            pendingUserMessages: [
                {
                    messageId: 'message-one',
                    runId: 'run-one',
                    runKind: 'manual',
                    text: 'First',
                    queuedAt: 1,
                },
            ],
        })

        const result = removeDeliveredPendingUserMessage(record, userMessageEndEvent('First'))

        expect(result.changed).toBe(false)
        expect(record.pendingUserMessages?.map((message) => message.messageId)).toEqual([
            'message-one',
        ])
    })
})

function threadRecord(
    input: Pick<ThreadRecord, 'activeRunId' | 'pendingUserMessages'>,
): ThreadRecord {
    return {
        key: 'thread',
        sessionFile: 'session.json',
        sessionId: 'session',
        title: 'Thread',
        titleSource: 'initial',
        status: 'running',
        createdAt: 1,
        updatedAt: 1,
        lastMessagePreview: null,
        modelProvider: null,
        model: null,
        thinkingLevel: null,
        speedMode: null,
        activeRunId: input.activeRunId,
        activeRunKind: input.activeRunId ? 'manual' : null,
        heartbeatAt: null,
        runStartedAt: null,
        runBudgetExpiresAt: null,
        idleTimeoutExpiresAt: null,
        activeDurationMs: 0,
        idleDurationMs: 0,
        lastError: null,
        kind: 'main',
        parentThreadKey: null,
        parentRunId: null,
        subagentRunId: null,
        subagentName: null,
        subagentTask: null,
        deepWorkRunId: null,
        deepWorkObjective: null,
        completedAt: null,
        pendingUserMessages: input.pendingUserMessages,
    }
}

function userMessageEndEvent(text: string): AgentSessionEvent {
    return {
        type: 'message_end',
        message: {
            role: 'user',
            content: [
                {
                    type: 'text',
                    text,
                },
            ],
            timestamp: 1,
        },
    } as AgentSessionEvent
}
