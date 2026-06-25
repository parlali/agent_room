import type { RoomFileChangedPayload } from '../execution-types'
import {
    openPiRuntimeEventStream,
    openPiRuntimeRoomEventStream,
    publishPiRuntimeRoomFileChanged,
} from '../pi-runtime-client'
import { createRuntimeEventProxyStream } from '../runtime-event-proxy-stream'

export function createRoomSessionEventStream(input: {
    roomId: string
    sessionKey: string
    abortSignal?: AbortSignal
}): ReadableStream<Uint8Array> {
    return createRuntimeEventProxyStream({
        roomId: input.roomId,
        sessionKey: input.sessionKey,
        streamKind: 'session',
        abortSignal: input.abortSignal,
        open: () =>
            openPiRuntimeEventStream({
                roomId: input.roomId,
                sessionKey: input.sessionKey,
                signal: input.abortSignal,
            }),
    })
}

export function createRoomEventStream(input: {
    roomId: string
    abortSignal?: AbortSignal
}): ReadableStream<Uint8Array> {
    return createRuntimeEventProxyStream({
        roomId: input.roomId,
        sessionKey: null,
        streamKind: 'room',
        abortSignal: input.abortSignal,
        open: () =>
            openPiRuntimeRoomEventStream({
                roomId: input.roomId,
                signal: input.abortSignal,
            }),
    })
}

export async function publishRoomFileChanged(input: RoomFileChangedPayload): Promise<void> {
    await publishPiRuntimeRoomFileChanged(input)
}
