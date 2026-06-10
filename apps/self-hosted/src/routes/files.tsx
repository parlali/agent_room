import { createFileRoute, redirect } from '@tanstack/react-router'

import { redirectToFirstRoomSurface } from './-room-entry-redirect'
import { requireRouteUser } from './-route-auth'

export const Route = createFileRoute('/files')({
    beforeLoad: async () => {
        await requireRouteUser()
        const redirected = await redirectToFirstRoomSurface('files')
        if (!redirected) {
            throw redirect({ to: '/', replace: true })
        }
    },
})
