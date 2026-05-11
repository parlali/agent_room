import type { RoomFileEntry, RoomFileSurface } from '#/server/rooms/file-store'

export interface RoomFileLinkInput {
    surface: RoomFileSurface
    relativePath: string
}

export function roomFilePreviewUrl(roomId: string, entry: RoomFileLinkInput): string {
    const params = new URLSearchParams({
        surface: entry.surface,
        path: entry.relativePath,
    })
    return `/api/rooms/${encodeURIComponent(roomId)}/files/preview?${params.toString()}`
}

export function roomFileEntryPreviewUrl(roomId: string, entry: RoomFileEntry): string {
    return roomFilePreviewUrl(roomId, entry)
}
