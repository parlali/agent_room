import { createFileRoute, redirect } from '@tanstack/react-router'

import { requireRouteUser } from './-route-auth'

export const Route = createFileRoute('/activity')({
    beforeLoad: async () => {
        await requireRouteUser()
        throw redirect({ to: '/usage', replace: true })
    },
})
