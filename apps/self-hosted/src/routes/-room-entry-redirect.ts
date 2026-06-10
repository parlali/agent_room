import { redirect } from '@tanstack/react-router'

import { listRoomsServer } from './-room-runtime-server'

type RoomSurface = 'home' | 'files' | 'jobs'

export async function redirectToFirstRoomSurface(surface: RoomSurface = 'home') {
    const [room] = await listRoomsServer()
    if (!room) return false

    if (surface === 'files') {
        throw redirect({
            to: '/rooms/$roomId/files',
            params: { roomId: room.roomId },
            replace: true,
        })
    }

    if (surface === 'jobs') {
        throw redirect({
            to: '/rooms/$roomId/jobs',
            params: { roomId: room.roomId },
            replace: true,
        })
    }

    throw redirect({
        to: '/rooms/$roomId',
        params: { roomId: room.roomId },
        replace: true,
    })
}
