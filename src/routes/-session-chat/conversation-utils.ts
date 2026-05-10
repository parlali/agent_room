import type { RoomExecutionMessage } from '#/server/rooms/execution-types'

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
