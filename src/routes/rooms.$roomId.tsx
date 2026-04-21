import { createFileRoute, useLocation } from '@tanstack/react-router'
import { RoomWorkspacePage } from './-room-workspace'
import type { RoomSurface } from './-room-workspace'
import { requireRouteUser } from './-route-auth'

export const Route = createFileRoute('/rooms/$roomId')({
    beforeLoad: requireRouteUser,
    component: RoomHomeRoute,
})

function RoomHomeRoute() {
    const { roomId } = Route.useParams()
    const location = useLocation()
    const suffix = location.pathname.slice(`/rooms/${roomId}`.length)
    const surface = resolveSurface(suffix)
    const sessionKey = resolveSessionKey(suffix)

    return <RoomWorkspacePage roomId={roomId} surface={surface} sessionKey={sessionKey} />
}

function resolveSurface(suffix: string): RoomSurface {
    if (suffix === '/files') {
        return 'files'
    }
    if (suffix === '/jobs') {
        return 'jobs'
    }
    if (suffix === '/status') {
        return 'status'
    }
    if (suffix === '/settings') {
        return 'settings'
    }
    if (suffix.startsWith('/sessions/')) {
        return 'session'
    }
    return 'home'
}

function resolveSessionKey(suffix: string): string | null {
    if (!suffix.startsWith('/sessions/')) {
        return null
    }
    const rawSessionKey = suffix.slice('/sessions/'.length)
    if (!rawSessionKey) {
        return null
    }
    return decodeURIComponent(rawSessionKey)
}
