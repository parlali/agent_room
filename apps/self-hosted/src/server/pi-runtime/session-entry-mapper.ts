import {
    emptyRuntimePart,
    extractTextFromRuntimeContent,
    normalizeRuntimeRole,
    runtimeTextPhaseFromSignature,
    toRuntimeSerializable,
} from '#/domain/runtime-message'
import type { RoomExecutionMessage, RoomExecutionMessagePart } from '../rooms/execution-types'
import type { SessionEntry } from '@mariozechner/pi-coding-agent'
import {
    displayTextWithPromptAttachments,
    type PromptAttachmentMetadata,
} from './prompt-attachments'
import { isRecord } from './runtime-redaction'

export function shortText(value: string, length = 120): string {
    const trimmed = value.replace(/\s+/g, ' ').trim()
    return trimmed.length > length ? `${trimmed.slice(0, length - 3)}...` : trimmed
}

function textPart(
    block: Record<string, unknown>,
    text: string,
    contentIndex: number | null,
): RoomExecutionMessagePart {
    return emptyRuntimePart({
        type: 'text',
        text,
        contentIndex,
        textPhase: runtimeTextPhaseFromSignature(block.textSignature),
    })
}

function toolCallPart(
    block: Record<string, unknown>,
    completedIds: Set<string>,
    contentIndex: number | null,
): RoomExecutionMessagePart {
    const toolCallId = typeof block.id === 'string' ? block.id : null
    return emptyRuntimePart({
        type: 'tool_call',
        text: typeof block.name === 'string' ? block.name : '',
        toolName: typeof block.name === 'string' ? block.name : null,
        toolCallId,
        status: toolCallId && completedIds.has(toolCallId) ? 'complete' : 'running',
        input: toRuntimeSerializable(block.arguments ?? {}),
        rawType: 'toolCall',
        contentIndex,
    })
}

function thinkingPart(
    block: Record<string, unknown>,
    contentIndex: number | null,
): RoomExecutionMessagePart {
    const text = typeof block.thinking === 'string' ? block.thinking : ''
    return emptyRuntimePart({
        type: 'thinking',
        text,
        status: block.redacted === true ? 'redacted' : 'complete',
        rawType: 'thinking',
        contentIndex,
        result: toRuntimeSerializable({
            redacted: block.redacted === true,
            hasThinking: typeof block.thinking === 'string' && block.thinking.length > 0,
            hasSignature: typeof block.thinkingSignature === 'string',
        }),
    })
}

function toolResultPart(message: Record<string, unknown>): RoomExecutionMessagePart {
    const text = extractTextFromRuntimeContent(message.content)
    const isError = message.isError === true || message.is_error === true
    return emptyRuntimePart({
        type: 'tool_result',
        text,
        toolCallId: typeof message.toolCallId === 'string' ? message.toolCallId : null,
        toolName: typeof message.toolName === 'string' ? message.toolName : null,
        status: isError ? 'error' : 'complete',
        result: toRuntimeSerializable(message.content ?? text),
        rawType: 'toolResult',
    })
}

export function entryTimestamp(entry: SessionEntry): number | null {
    return Number.isFinite(Date.parse(entry.timestamp)) ? Date.parse(entry.timestamp) : null
}

function mapCompactionEntry(entry: SessionEntry, index: number): RoomExecutionMessage | null {
    if (entry.type !== 'compaction') {
        return null
    }
    const tokensBefore =
        typeof entry.tokensBefore === 'number' && Number.isFinite(entry.tokensBefore)
            ? entry.tokensBefore
            : null
    const text = tokensBefore
        ? `Context compacted after ${tokensBefore.toLocaleString()} tokens. Recent work and a summary were kept.`
        : 'Context compacted. Recent work and a summary were kept.'
    return {
        id: entry.id || `compaction-${index + 1}`,
        role: 'system',
        text,
        parts: [
            emptyRuntimePart({
                type: 'raw',
                text,
                status: 'complete',
                rawType: 'compaction',
                result: toRuntimeSerializable({
                    tokensBefore,
                }),
            }),
        ],
        timestamp: entryTimestamp(entry),
    }
}

export function mapSessionEntry(
    entry: SessionEntry,
    index: number,
    completedIds: Set<string>,
    attachmentMetadata?: Map<string, PromptAttachmentMetadata>,
): RoomExecutionMessage | null {
    const compaction = mapCompactionEntry(entry, index)
    if (compaction) {
        return compaction
    }
    if (entry.type !== 'message') {
        return null
    }
    const message = entry.message as unknown as Record<string, unknown>
    const role = normalizeRuntimeRole(message.role)
    if (role === 'tool') {
        const part = toolResultPart(message)
        return {
            id: entry.id || `message-${index + 1}`,
            role,
            text: part.text,
            parts: [part],
            timestamp: entryTimestamp(entry),
        }
    }
    const content = message.content
    const parts: RoomExecutionMessagePart[] = []
    if (Array.isArray(content)) {
        for (const [contentIndex, block] of content.entries()) {
            if (!isRecord(block)) {
                continue
            }
            if (block.type === 'text') {
                const text = extractTextFromRuntimeContent(block)
                if (text) {
                    parts.push(textPart(block, text, contentIndex))
                }
            } else if (block.type === 'thinking') {
                parts.push(thinkingPart(block, contentIndex))
            } else if (block.type === 'toolCall') {
                parts.push(toolCallPart(block, completedIds, contentIndex))
            } else {
                parts.push(
                    emptyRuntimePart({
                        rawType: typeof block.type === 'string' ? block.type : null,
                        input: toRuntimeSerializable(block),
                        contentIndex,
                    }),
                )
            }
        }
    } else {
        const text = extractTextFromRuntimeContent(content)
        if (text) {
            parts.push(textPart({}, text, null))
        }
    }
    const text =
        extractTextFromRuntimeContent(content) ||
        (typeof message.errorMessage === 'string' ? message.errorMessage : '')
    const displayText =
        role === 'user'
            ? displayTextWithPromptAttachments(
                  text,
                  entry.parentId ? (attachmentMetadata?.get(entry.parentId) ?? null) : null,
              )
            : text

    return {
        id: entry.id || `message-${index + 1}`,
        role,
        text: displayText,
        parts,
        timestamp: entryTimestamp(entry),
        provider: typeof message.provider === 'string' ? message.provider : null,
        model: typeof message.model === 'string' ? message.model : null,
    }
}

export function completedToolCallIds(entries: SessionEntry[]): Set<string> {
    const out = new Set<string>()
    for (const entry of entries) {
        if (entry.type !== 'message') {
            continue
        }
        const message = entry.message as unknown as Record<string, unknown>
        if (typeof message.toolCallId === 'string') {
            out.add(message.toolCallId)
        }
    }
    return out
}

export function latestAssistantErrorMessage(
    entries: SessionEntry[],
    redactString: (value: string) => string,
): string | null {
    for (let index = entries.length - 1; index >= 0; index -= 1) {
        const entry = entries[index]
        if (!entry || entry.type !== 'message') {
            continue
        }
        const message = entry.message as unknown as Record<string, unknown>
        if (message.role !== 'assistant') {
            continue
        }
        if (message.stopReason === 'aborted') {
            return null
        }
        if (typeof message.errorMessage === 'string' && message.errorMessage.trim()) {
            return shortText(redactString(message.errorMessage), 600)
        }
        if (message.stopReason === 'error') {
            return 'Provider returned stop reason error'
        }
    }
    return null
}
