import { createFileRoute } from '@tanstack/react-router'
import { RoomWorkspacePage } from './-room-workspace'
import { requireRouteUser } from './-route-auth'

export const Route = createFileRoute('/rooms/$roomId/files')({
    beforeLoad: requireRouteUser,
    component: RoomFilesRoute,
})

function RoomFilesRoute() {
    const { roomId } = Route.useParams()
    return <RoomWorkspacePage roomId={roomId} surface="files" />
}
