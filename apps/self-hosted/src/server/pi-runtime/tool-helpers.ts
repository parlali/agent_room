import type { AgentToolResult } from '@mariozechner/pi-coding-agent'

export function textToolResult<TDetails extends object>(
    text: string,
    details = {} as TDetails,
): AgentToolResult<TDetails> {
    return {
        content: [
            {
                type: 'text',
                text,
            },
        ],
        details,
    }
}

export function clampPositiveInteger(value: unknown, fallback: number, max: number): number {
    const number =
        typeof value === 'number' && Number.isFinite(value) ? Math.floor(value) : fallback
    return Math.min(max, Math.max(1, number))
}
