import { createFileRoute } from '@tanstack/react-router'
import { RoomWorkspacePage } from './-room-workspace'
import { requireRouteUser } from './-route-auth'

export const Route = createFileRoute('/rooms/$roomId/status')({
    beforeLoad: requireRouteUser,
    component: RoomStatusRoute,
})

function RoomStatusRoute() {
    const { roomId } = Route.useParams()
    return <RoomWorkspacePage roomId={roomId} surface="status" />
}
