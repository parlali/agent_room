import type { JsonValue } from './domain-types'
import type { RoomExecutionMessage, RoomExecutionMessagePart } from './room-execution-types'

export type RuntimeSerializable = JsonValue
export type RuntimeTextPhase = RoomExecutionMessagePart['textPhase']

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function toRuntimeSerializable(value: unknown): RuntimeSerializable {
    if (value === null || value === undefined) {
        return null
    }
    if (typeof value === 'number') {
        return Number.isFinite(value) ? value : null
    }
    if (typeof value === 'string' || typeof value === 'boolean') {
        return value
    }
    if (Array.isArray(value)) {
        return value.map((entry) => toRuntimeSerializable(entry))
    }
    if (isRecord(value)) {
        const out: Record<string, RuntimeSerializable> = {}
        for (const [key, entry] of Object.entries(value)) {
            out[key] = toRuntimeSerializable(entry)
        }
        return out
    }
    return String(value)
}

export function normalizeRuntimeRole(value: unknown): RoomExecutionMessage['role'] {
    if (value === 'user' || value === 'assistant' || value === 'tool' || value === 'system') {
        return value
    }
    if (value === 'toolResult') {
        return 'tool'
    }
    return 'other'
}

function textFromContentBlock(block: unknown): string {
    if (typeof block === 'string') {
        return block
    }
    if (!isRecord(block)) {
        return ''
    }
    if (block.type === 'thinking') {
        return ''
    }
    if (typeof block.text === 'string') {
        return block.text
    }
    if (typeof block.content === 'string') {
        return block.content
    }
    return ''
}

export function extractTextFromRuntimeContent(content: unknown): string {
    if (typeof content === 'string') {
        return content
    }
    if (Array.isArray(content)) {
        return content
            .map((block) => textFromContentBlock(block))
            .filter((part) => part.trim().length > 0)
            .join('\n')
    }
    return textFromContentBlock(content)
}

export function runtimeTextPhaseFromSignature(value: unknown): RuntimeTextPhase {
    if (typeof value !== 'string' || !value.trim().startsWith('{')) {
        return null
    }

    try {
        const parsed = JSON.parse(value) as unknown
        if (!isRecord(parsed) || parsed.v !== 1) {
            return null
        }
        if (parsed.phase === 'commentary' || parsed.phase === 'final_answer') {
            return parsed.phase
        }
    } catch {}

    return null
}

export function emptyRuntimePart(
    input?: Partial<RoomExecutionMessagePart>,
): RoomExecutionMessagePart {
    return {
        type: input?.type ?? 'raw',
        text: input?.text ?? '',
        toolName: input?.toolName ?? null,
        toolCallId: input?.toolCallId ?? null,
        status: input?.status ?? null,
        input: input?.input ?? null,
        result: input?.result ?? null,
        rawType: input?.rawType ?? null,
        contentIndex: input?.contentIndex ?? null,
        textPhase: input?.textPhase ?? null,
    }
}
