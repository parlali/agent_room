import { createFileRoute } from '@tanstack/react-router'
import { RoomWorkspacePage } from './-room-workspace'
import { requireRouteUser } from './-route-auth'

export const Route = createFileRoute('/rooms/$roomId/settings')({
    beforeLoad: requireRouteUser,
    component: RoomSettingsRoute,
})

function RoomSettingsRoute() {
    const { roomId } = Route.useParams()
    return <RoomWorkspacePage roomId={roomId} surface="settings" />
}
