import { createFileRoute } from '@tanstack/react-router'

import { SessionChatPane } from '#/routes/-session-chat/session-chat-pane'

export const Route = createFileRoute('/rooms/$roomId/sessions/$sessionKey')({
    component: SessionChatRoute,
})

function SessionChatRoute() {
    const { roomId, sessionKey } = Route.useParams()
    return <SessionChatPane roomId={roomId} sessionKey={sessionKey} />
}
