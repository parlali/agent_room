import { createFileRoute } from '@tanstack/react-router'

import { RoomDashboardLayout } from '#/components/room-dashboard'
import { SessionChatPane } from '#/routes/-session-chat/session-chat-pane'

export const Route = createFileRoute('/rooms/$roomId/sessions/$sessionKey')({
    component: SessionChatRoute,
})

function SessionChatRoute() {
    const { roomId, sessionKey } = Route.useParams()
    return (
        <RoomDashboardLayout roomId={roomId} activeTab="chat" fill>
            <SessionChatPane roomId={roomId} sessionKey={sessionKey} />
        </RoomDashboardLayout>
    )
}
