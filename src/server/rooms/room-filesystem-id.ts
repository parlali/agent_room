import { createHash } from 'node:crypto'

export function assertSafeRoomPathId(roomId: string): void {
    if (!/^[a-zA-Z0-9_-]+$/.test(roomId)) {
        throw new Error('Room id is not a safe path segment')
    }
}

export function roomFilesystemId(roomId: string): string {
    assertSafeRoomPathId(roomId)
    return `r-${createHash('sha256').update(roomId).digest('hex').slice(0, 32)}`
}
