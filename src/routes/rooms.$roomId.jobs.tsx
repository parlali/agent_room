import { createFileRoute } from '@tanstack/react-router'
import { RoomWorkspacePage } from './-room-workspace'
import { requireRouteUser } from './-route-auth'

export const Route = createFileRoute('/rooms/$roomId/jobs')({
    beforeLoad: requireRouteUser,
    component: RoomJobsRoute,
})

function RoomJobsRoute() {
    const { roomId } = Route.useParams()
    return <RoomWorkspacePage roomId={roomId} surface="jobs" />
}
