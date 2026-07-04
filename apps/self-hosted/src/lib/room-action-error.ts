import { toast } from 'sonner'

import { sanitizeRuntimeError } from '#/domain/runtime-error'
import {
    isRecurringRoomErrorClass,
    roomErrorClasses,
    roomErrorToastId,
    roomRuntimeErrorClass,
} from '#/routes/-session-chat/room-error-toast'

export function reportRoomActionError(input: {
    roomId: string
    error: unknown
    title: string
}): void {
    const message = input.error instanceof Error ? input.error.message : null
    const errorClass = roomRuntimeErrorClass(message)
    if (isRecurringRoomErrorClass(errorClass)) {
        dismissRoomActionErrors(input.roomId)
        return
    }
    toast.error(input.title, {
        id: roomErrorToastId(input.roomId, errorClass),
        description: sanitizeRuntimeError(message),
    })
}

export function dismissRoomActionErrors(roomId: string): void {
    for (const errorClass of roomErrorClasses) {
        toast.dismiss(roomErrorToastId(roomId, errorClass))
    }
}
