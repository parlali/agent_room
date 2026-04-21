import { createFileRoute } from '@tanstack/react-router'
import { RoomWorkspacePage } from './-room-workspace'
import { requireRouteUser } from './-route-auth'

export const Route = createFileRoute('/rooms/$roomId/sessions/$sessionKey')({
    beforeLoad: requireRouteUser,
    component: RoomSessionRoute,
})

function RoomSessionRoute() {
    const { roomId, sessionKey } = Route.useParams()
    return <RoomWorkspacePage roomId={roomId} surface="session" sessionKey={sessionKey} />
}
