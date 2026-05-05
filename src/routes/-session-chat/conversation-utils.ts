import type { RoomExecutionMessage } from '#/server/rooms/execution-types'

export function dedupeMessages(messages: RoomExecutionMessage[]): RoomExecutionMessage[] {
    const seen = new Set<string>()
    const out: RoomExecutionMessage[] = []
    for (const message of messages) {
        if (seen.has(message.id)) continue
        seen.add(message.id)
        out.push(message)
    }
    return out
}

export function isLastMessageInProgress(messages: RoomExecutionMessage[] | undefined): boolean {
    if (!messages || messages.length === 0) return false
    const last = messages[messages.length - 1]!
    if (last.role !== 'assistant') return false
    if (last.id.startsWith('stream-')) return true
    for (const part of last.parts) {
        if (part.type !== 'tool_call') continue
        const status = part.status?.toLowerCase() ?? ''
        if (!status || status.includes('pending') || status.includes('running')) {
            return true
        }
    }
    return false
}

export function extractLatestStreamRunId(messages: RoomExecutionMessage[]): string | null {
    for (let i = messages.length - 1; i >= 0; i -= 1) {
        const message = messages[i]!
        if (message.role === 'assistant' && message.id.startsWith('stream-')) {
            return message.id.slice('stream-'.length)
        }
    }
    return null
}
