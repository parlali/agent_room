import type {
    RoomExecutionAgent,
    RoomExecutionMessage,
    RoomExecutionThread,
} from '#/domain/room-execution-types'

export const roomViewReadModelDir = 'view'
export const roomViewThreadsRelativePath = `${roomViewReadModelDir}/threads.json`
export const roomViewThreadMessageCap = 500

export function encodeRoomViewThreadKey(threadKey: string): string {
    return threadKey.replace(/[^a-zA-Z0-9_-]/g, (char) => `_${char.charCodeAt(0).toString(16)}_`)
}

export function roomViewThreadRelativePath(threadKey: string): string {
    return `${roomViewReadModelDir}/thread-${encodeRoomViewThreadKey(threadKey)}.json`
}

const roomViewThreadRelativePathPattern = new RegExp(
    `^${roomViewReadModelDir}/thread-[a-zA-Z0-9_-]+\\.json$`,
)

export function isRoomViewReadModelRelativePath(relativePath: string): boolean {
    return (
        relativePath === roomViewThreadsRelativePath ||
        roomViewThreadRelativePathPattern.test(relativePath)
    )
}

export interface RoomViewThreadsReadModel {
    roomAgent: RoomExecutionAgent
    threads: RoomExecutionThread[]
    extraAgentIds: string[]
}

export interface RoomViewThreadReadModel {
    messages: RoomExecutionMessage[]
}
