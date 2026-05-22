export const roomFileUploadPolicy = {
    maxFilesPerRequest: 10,
    maxBytesPerFile: 50 * 1024 * 1024,
    maxBytesPerRequest: 100 * 1024 * 1024,
} as const

export type RoomFileUploadPolicyErrorCode =
    | 'empty_upload'
    | 'too_many_files'
    | 'file_too_large'
    | 'request_too_large'

export interface RoomUploadPolicyFile {
    name?: string | null
    size: number
}

export class RoomFileUploadPolicyError extends Error {
    readonly code: RoomFileUploadPolicyErrorCode

    constructor(code: RoomFileUploadPolicyErrorCode, message: string) {
        super(message)
        this.name = 'RoomFileUploadPolicyError'
        this.code = code
    }
}

export function formatRoomUploadBytes(bytes: number): string {
    if (bytes >= 1024 * 1024 && bytes % (1024 * 1024) === 0) {
        return `${bytes / (1024 * 1024)} MB`
    }
    if (bytes >= 1024 && bytes % 1024 === 0) {
        return `${bytes / 1024} KB`
    }
    return `${bytes} bytes`
}

export function validateRoomFileUpload(files: readonly RoomUploadPolicyFile[]): void {
    if (files.length === 0) {
        throw new RoomFileUploadPolicyError('empty_upload', 'No files were uploaded')
    }

    if (files.length > roomFileUploadPolicy.maxFilesPerRequest) {
        throw new RoomFileUploadPolicyError(
            'too_many_files',
            `Upload is limited to ${roomFileUploadPolicy.maxFilesPerRequest} files`,
        )
    }

    const oversizedFile = files.find((file) => file.size > roomFileUploadPolicy.maxBytesPerFile)
    if (oversizedFile) {
        const name = oversizedFile.name?.trim()
        throw new RoomFileUploadPolicyError(
            'file_too_large',
            name
                ? `Uploads are limited to ${formatRoomUploadBytes(roomFileUploadPolicy.maxBytesPerFile)} per file: ${name}`
                : `Uploads are limited to ${formatRoomUploadBytes(roomFileUploadPolicy.maxBytesPerFile)} per file`,
        )
    }

    const totalBytes = totalRoomUploadBytes(files)
    if (totalBytes > roomFileUploadPolicy.maxBytesPerRequest) {
        throw new RoomFileUploadPolicyError(
            'request_too_large',
            `Upload is limited to ${formatRoomUploadBytes(roomFileUploadPolicy.maxBytesPerRequest)} per request`,
        )
    }
}

export function totalRoomUploadBytes(files: readonly RoomUploadPolicyFile[]): number {
    return files.reduce((sum, file) => sum + file.size, 0)
}
