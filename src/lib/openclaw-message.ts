export type OpenClawMessagePartType = 'text' | 'tool_call' | 'tool_result' | 'raw'
export type OpenClawSerializable =
    | string
    | number
    | boolean
    | null
    | OpenClawSerializable[]
    | { [key: string]: OpenClawSerializable }

export interface OpenClawMessagePart {
    type: OpenClawMessagePartType
    text: string
    toolName: string | null
    toolCallId: string | null
    status: string | null
    input: OpenClawSerializable
    result: OpenClawSerializable
    rawType: string | null
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null
}

function readString(record: Record<string, unknown>, keys: string[]): string | null {
    for (const key of keys) {
        const value = record[key]
        if (typeof value === 'string' && value.trim()) {
            return value
        }
    }

    return null
}

function normalizeType(value: unknown): string | null {
    if (typeof value !== 'string') {
        return null
    }

    const trimmed = value.trim().toLowerCase()
    return trimmed ? trimmed : null
}

function isToolCallType(value: string | null): boolean {
    return (
        value === 'toolcall' ||
        value === 'tool_call' ||
        value === 'tooluse' ||
        value === 'tool_use' ||
        value === 'function_call' ||
        value === 'function'
    )
}

function isToolResultType(value: string | null): boolean {
    return (
        value === 'toolresult' ||
        value === 'tool_result' ||
        value === 'tool' ||
        value === 'function_result'
    )
}

function readText(record: Record<string, unknown>): string {
    const text = readString(record, ['text', 'content', 'message', 'output'])
    return text ?? ''
}

function toSerializable(value: unknown): OpenClawSerializable {
    if (value === null || value === undefined) {
        return null
    }
    if (typeof value === 'string' || typeof value === 'boolean') {
        return value
    }
    if (typeof value === 'number') {
        return Number.isFinite(value) ? value : null
    }
    if (typeof value === 'bigint') {
        return value.toString()
    }
    if (Array.isArray(value)) {
        return value.map((entry) => toSerializable(entry))
    }
    if (isRecord(value)) {
        const output: { [key: string]: OpenClawSerializable } = {}
        for (const [key, entry] of Object.entries(value)) {
            output[key] = toSerializable(entry)
        }
        return output
    }

    return null
}

function buildTextPart(text: string): OpenClawMessagePart | null {
    if (!text) {
        return null
    }

    return {
        type: 'text',
        text,
        toolName: null,
        toolCallId: null,
        status: null,
        input: null,
        result: null,
        rawType: 'text',
    }
}

function buildToolPart(
    type: 'tool_call' | 'tool_result',
    record: Record<string, unknown>,
): OpenClawMessagePart {
    const toolName = readString(record, ['toolName', 'tool_name', 'name', 'functionName'])
    const toolCallId = readString(record, ['toolCallId', 'tool_call_id', 'id', 'callId'])
    const status = readString(record, ['status', 'phase', 'state'])
    const rawType = normalizeType(record.type)
    const input = toSerializable(record.input ?? record.arguments ?? record.args ?? record.params)
    const result = toSerializable(record.result ?? record.output ?? record.content)
    const fallbackText =
        type === 'tool_call'
            ? toolName
                ? `Tool call: ${toolName}`
                : 'Tool call'
            : readText(record)

    return {
        type,
        text: fallbackText,
        toolName,
        toolCallId,
        status,
        input,
        result,
        rawType,
    }
}

function buildRawPart(record: Record<string, unknown>): OpenClawMessagePart | null {
    const text = readText(record)
    if (!text) {
        return null
    }

    return {
        type: 'raw',
        text,
        toolName: null,
        toolCallId: null,
        status: readString(record, ['status', 'phase', 'state']),
        input: null,
        result: null,
        rawType: normalizeType(record.type),
    }
}

function extractBlockPart(block: unknown): OpenClawMessagePart | null {
    if (typeof block === 'string') {
        return buildTextPart(block)
    }

    if (!isRecord(block)) {
        return null
    }

    const blockType = normalizeType(block.type)
    if (isToolCallType(blockType) || readString(block, ['toolName', 'tool_name']) !== null) {
        return buildToolPart('tool_call', block)
    }

    if (isToolResultType(blockType)) {
        return buildToolPart('tool_result', block)
    }

    return buildTextPart(readText(block)) ?? buildRawPart(block)
}

export function toOpenClawMessagePayload(value: unknown): Record<string, unknown> {
    if (!isRecord(value)) {
        return {}
    }

    if (isRecord(value.message)) {
        return value.message
    }

    return value
}

export function extractOpenClawMessageParts(value: unknown): OpenClawMessagePart[] {
    const payload = toOpenClawMessagePayload(value)
    const parts: OpenClawMessagePart[] = []
    const role = normalizeType(payload.role)

    if (role === 'tool' || role === 'tool_result' || role === 'function') {
        parts.push(buildToolPart('tool_result', payload))
        return parts
    }

    const directText = readString(payload, ['text'])
    if (directText !== null) {
        const part = buildTextPart(directText)
        if (part) {
            parts.push(part)
        }
    }

    const content = payload.content
    if (typeof content === 'string') {
        const part = buildTextPart(content)
        if (part) {
            parts.push(part)
        }
    } else if (Array.isArray(content)) {
        for (const block of content) {
            const part = extractBlockPart(block)
            if (part) {
                parts.push(part)
            }
        }
    }

    if (parts.length === 0 && (isToolCallType(normalizeType(payload.type)) || payload.tool_calls)) {
        parts.push(buildToolPart('tool_call', payload))
    }

    return parts
}

export function extractOpenClawMessageText(value: unknown): string {
    return extractOpenClawMessageParts(value)
        .map((part) => part.text)
        .filter((text) => text.trim().length > 0)
        .join('\n')
}
