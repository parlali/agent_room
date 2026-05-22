import type { AgentSessionEvent } from '@mariozechner/pi-coding-agent'
import type { ThreadRecord } from './thread-records'

export function removeDeliveredPendingUserMessage(
    record: ThreadRecord,
    event: AgentSessionEvent,
): { changed: boolean; event: AgentSessionEvent } {
    const messageId = deliveredPendingUserMessageId(record, event)
    if (!messageId) {
        return {
            changed: false,
            event,
        }
    }
    const pending = record.pendingUserMessages ?? []
    const next = pending.filter((message) => message.messageId !== messageId)
    if (next.length === pending.length) {
        return {
            changed: false,
            event,
        }
    }
    record.pendingUserMessages = next
    record.updatedAt = Date.now()
    return {
        changed: true,
        event: eventWithDeliveredPendingMessageId(event, messageId),
    }
}

export function deliveredPendingUserMessageId(
    record: ThreadRecord,
    event: AgentSessionEvent,
): string | null {
    if (event.type !== 'message_end') return null
    const message = event.message as { role?: unknown; id?: unknown; messageId?: unknown }
    if (message.role !== 'user') return null
    const pending = record.pendingUserMessages ?? []
    const eventMessageId = stringValue(message.messageId) ?? stringValue(message.id)
    if (eventMessageId && pending.some((candidate) => candidate.messageId === eventMessageId)) {
        return eventMessageId
    }
    if (!record.activeRunId) return null
    return pending.find((candidate) => candidate.runId === record.activeRunId)?.messageId ?? null
}

function eventWithDeliveredPendingMessageId(
    event: AgentSessionEvent,
    messageId: string,
): AgentSessionEvent {
    if (event.type !== 'message_end') return event
    return {
        ...event,
        message: {
            ...event.message,
            messageId,
        },
    } as unknown as AgentSessionEvent
}

function stringValue(value: unknown): string | null {
    return typeof value === 'string' && value.length > 0 ? value : null
}
