import type { RoomExecutionMessage } from '../rooms/execution-types'

export function finalAssistantText(messages: RoomExecutionMessage[]): string {
    return (
        [...messages]
            .reverse()
            .find((message) => message.role === 'assistant' && message.text.trim())
            ?.text.trim() ?? ''
    )
}
