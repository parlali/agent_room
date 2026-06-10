import { isRecord } from './runtime-redaction'

export function runtimeEventLogPayload(event: string, payload: unknown): unknown {
    const payloadRecord = isRecord(payload) ? payload : null
    const innerEvent = isRecord(payloadRecord?.event) ? payloadRecord.event : null
    const innerType = typeof innerEvent?.type === 'string' ? innerEvent.type : event
    if (innerType !== 'message_update') {
        return payload
    }

    const assistantEvent = isRecord(innerEvent?.assistantMessageEvent)
        ? innerEvent.assistantMessageEvent
        : null
    const assistantType = typeof assistantEvent?.type === 'string' ? assistantEvent.type : 'unknown'
    const textDelta =
        typeof assistantEvent?.delta === 'string'
            ? assistantEvent.delta
            : typeof assistantEvent?.content === 'string'
              ? assistantEvent.content
              : ''
    return {
        ...(payloadRecord ?? {}),
        event: {
            type: innerType,
            assistantMessageEvent: {
                type: assistantType,
                contentIndex:
                    typeof assistantEvent?.contentIndex === 'number'
                        ? assistantEvent.contentIndex
                        : null,
                textLength: textDelta.length,
            },
        },
    }
}

export function runtimeBroadcastPayload(event: string, payload: unknown): unknown {
    const payloadRecord = isRecord(payload) ? payload : null
    const innerEvent = isRecord(payloadRecord?.event) ? payloadRecord.event : null
    const innerType = typeof innerEvent?.type === 'string' ? innerEvent.type : event
    if (!payloadRecord || !innerEvent) {
        return payload
    }

    if (innerType === 'message_update') {
        return {
            ...payloadRecord,
            event: {
                type: innerType,
                assistantMessageEvent: compactAssistantMessageEvent(
                    innerEvent.assistantMessageEvent,
                ),
            },
        }
    }

    if (innerType === 'message_end' || innerType === 'turn_end') {
        return {
            ...payloadRecord,
            event: {
                type: innerType,
                message: compactRuntimeMessage(innerEvent.message),
            },
        }
    }

    if (innerType === 'message_start') {
        return {
            ...payloadRecord,
            event: {
                type: innerType,
                message: compactRuntimeMessage(innerEvent.message),
            },
        }
    }

    if (innerType === 'agent_end') {
        return {
            ...payloadRecord,
            event: {
                type: innerType,
            },
        }
    }

    return payload
}

function compactAssistantMessageEvent(value: unknown): Record<string, unknown> | null {
    const event = isRecord(value) ? value : null
    if (!event) return null

    const out: Record<string, unknown> = {
        type: typeof event.type === 'string' ? event.type : 'unknown',
    }
    const contentIndex = contentIndexFromEvent(event)
    if (contentIndex !== null) {
        out.contentIndex = contentIndex
    }
    if (typeof event.delta === 'string') {
        out.delta = event.delta
    }
    if (typeof event.content === 'string') {
        out.content = event.content
    }

    const toolCall = compactToolCall(
        isRecord(event.toolCall) ? event.toolCall : blockFromPartial(event.partial, contentIndex),
    )
    if (toolCall) {
        out.toolCall = toolCall
    }

    const partialBlock = compactPartialBlock({
        block: blockFromPartial(event.partial, contentIndex),
        eventType: typeof event.type === 'string' ? event.type : null,
    })
    if (partialBlock && contentIndex !== null) {
        const content: Array<Record<string, unknown> | null> = Array.from(
            { length: contentIndex + 1 },
            () => null,
        )
        content[contentIndex] = partialBlock
        out.partial = {
            role: 'assistant',
            content,
        }
    }

    return out
}

function compactRuntimeMessage(value: unknown): Record<string, unknown> | null {
    const message = isRecord(value) ? value : null
    if (!message) return null
    const role = typeof message.role === 'string' ? message.role : 'other'
    return {
        role,
        content: role === 'assistant' ? compactContentBlocks(message.content) : [],
    }
}

function compactContentBlocks(content: unknown): unknown[] {
    if (!Array.isArray(content)) return []
    return content.map((block) => compactMessageBlock(isRecord(block) ? block : null))
}

function compactMessageBlock(
    block: Record<string, unknown> | null,
): Record<string, unknown> | null {
    if (!block) return null
    if (block.type === 'text') {
        return compactTextBlock(block, true)
    }
    if (block.type === 'thinking') {
        return {
            type: 'thinking',
            redacted: true,
        }
    }
    if (block.type === 'toolCall') {
        return compactToolCall(block)
    }
    return {
        type: typeof block.type === 'string' ? block.type : 'unknown',
    }
}

function compactPartialBlock(input: {
    block: Record<string, unknown> | null
    eventType: string | null
}): Record<string, unknown> | null {
    const block = input.block
    if (!block) return null
    if (block.type === 'text') {
        return compactTextBlock(block, input.eventType !== 'text_delta')
    }
    if (block.type === 'thinking') {
        return {
            type: 'thinking',
            redacted: true,
        }
    }
    if (block.type === 'toolCall') {
        return compactToolCall(block)
    }
    return null
}

function compactTextBlock(
    block: Record<string, unknown>,
    includeText: boolean,
): Record<string, unknown> {
    const out: Record<string, unknown> = {
        type: 'text',
    }
    if (includeText && typeof block.text === 'string') {
        out.text = block.text
    }
    if (typeof block.textSignature === 'string') {
        out.textSignature = block.textSignature
    }
    return out
}

function compactToolCall(block: Record<string, unknown> | null): Record<string, unknown> | null {
    if (!block || block.type !== 'toolCall') return null
    return {
        type: 'toolCall',
        id: typeof block.id === 'string' ? block.id : null,
        name: typeof block.name === 'string' ? block.name : null,
        arguments: isRecord(block.arguments) ? block.arguments : {},
    }
}

function blockFromPartial(
    partial: unknown,
    contentIndex: number | null,
): Record<string, unknown> | null {
    const partialRecord = isRecord(partial) ? partial : null
    if (partialRecord?.role !== 'assistant') return null
    if (!Array.isArray(partialRecord.content) || contentIndex === null) return null
    const block = partialRecord.content[contentIndex]
    return isRecord(block) ? block : null
}

function contentIndexFromEvent(event: Record<string, unknown>): number | null {
    return typeof event.contentIndex === 'number' &&
        Number.isInteger(event.contentIndex) &&
        event.contentIndex >= 0
        ? event.contentIndex
        : null
}
