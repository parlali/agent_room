import type { RoomFileEntry, RoomFileSurface } from '#/lib/room-file-types'

export interface UploadRoomFilesInput {
    roomId: string
    files: File[]
    surface?: RoomFileSurface
    path?: string
    sessionKey?: string
}

export interface UploadRoomFilesResult {
    files: RoomFileEntry[]
}

export async function uploadRoomFiles(input: UploadRoomFilesInput): Promise<UploadRoomFilesResult> {
    const body = new FormData()
    if (input.surface) {
        body.set('surface', input.surface)
    }
    if (input.path) {
        body.set('path', input.path)
    }
    if (input.sessionKey) {
        body.set('sessionKey', input.sessionKey)
    }
    for (const file of input.files) {
        body.append('files', file)
    }

    const response = await fetch(`/api/rooms/${encodeURIComponent(input.roomId)}/files/upload`, {
        method: 'POST',
        body,
        credentials: 'same-origin',
    })

    if (!response.ok) {
        const message = await response.text()
        throw new Error(message || `Upload failed with status ${response.status}`)
    }

    return (await response.json()) as UploadRoomFilesResult
}
