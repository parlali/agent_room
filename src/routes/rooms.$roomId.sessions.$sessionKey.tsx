import { createFileRoute } from '@tanstack/react-router'

import { AppShell } from '#/components/app-shell'
import { TooltipProvider } from '#/components/ui/tooltip'
import { SessionChatPane } from '#/routes/-session-chat/session-chat-pane'
import { requireRouteUser } from '#/routes/-route-auth'

export const Route = createFileRoute('/rooms/$roomId/sessions/$sessionKey')({
    beforeLoad: requireRouteUser,
    component: SessionChatRoute,
})

function SessionChatRoute() {
    const { roomId, sessionKey } = Route.useParams()
    return (
        <AppShell>
            <TooltipProvider delayDuration={150}>
                <SessionChatPane roomId={roomId} sessionKey={sessionKey} />
            </TooltipProvider>
        </AppShell>
    )
}
