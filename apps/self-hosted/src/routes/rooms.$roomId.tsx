import { Outlet, createFileRoute, useRouterState } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'

import { RoomDashboardLayout, type RoomDashboardTab } from '#/components/room-dashboard'
import { requireRouteUser } from './-route-auth'
import { useRoomEventCacheSync } from './-session-chat/room-event-cache'

export const Route = createFileRoute('/rooms/$roomId')({
    beforeLoad: requireRouteUser,
    component: RoomRoute,
})

function deriveRoomTab(pathname: string): RoomDashboardTab {
    if (pathname.endsWith('/files')) return 'files'
    if (pathname.endsWith('/jobs')) return 'tasks'
    if (pathname.endsWith('/memory')) return 'memory'
    if (pathname.endsWith('/settings')) return 'settings'
    return 'chat'
}

function RoomRoute() {
    const { roomId } = Route.useParams()
    const queryClient = useQueryClient()
    const pathname = useRouterState({
        select: (state) => state.location.pathname,
    })
    useRoomEventCacheSync({ roomId, queryClient })

    return (
        <RoomDashboardLayout roomId={roomId} activeTab={deriveRoomTab(pathname)}>
            <Outlet />
        </RoomDashboardLayout>
    )
}
