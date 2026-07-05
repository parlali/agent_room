export type RoomErrorClass = 'quota' | 'runtime' | 'transient'

export const roomErrorClasses: readonly RoomErrorClass[] = ['quota', 'runtime', 'transient']

export function roomRuntimeErrorClass(message: string | null | undefined): RoomErrorClass {
    if (!message) return 'transient'
    const normalized = message.toLowerCase()
    if (
        normalized.includes('spend cap') ||
        normalized.includes('out of credit') ||
        normalized.includes('insufficient credit') ||
        normalized.includes('not enough credit') ||
        normalized.includes('quota') ||
        normalized.includes('rate limit') ||
        normalized.includes('too many requests') ||
        normalized.includes('status 429')
    ) {
        return 'quota'
    }
    if (
        normalized.includes('callback failed') ||
        normalized.includes('runtime state') ||
        normalized.includes('runtime unavailable') ||
        normalized.includes('runtime error') ||
        /status 5\d\d/.test(normalized)
    ) {
        return 'runtime'
    }
    return 'transient'
}

export function isRecurringRoomErrorClass(errorClass: RoomErrorClass): boolean {
    return errorClass === 'quota' || errorClass === 'runtime'
}

export function roomErrorToastId(roomId: string, errorClass: RoomErrorClass): string {
    return `room-error:${errorClass}:${roomId}`
}
