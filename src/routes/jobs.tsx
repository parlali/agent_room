import { createFileRoute, redirect } from '@tanstack/react-router'

import { redirectToFirstRoomSurface } from './-room-entry-redirect'
import { requireRouteUser } from './-route-auth'

export const Route = createFileRoute('/jobs')({
    beforeLoad: async () => {
        await requireRouteUser()
        const redirected = await redirectToFirstRoomSurface('jobs')
        if (!redirected) {
            throw redirect({ to: '/', replace: true })
        }
    },
})
