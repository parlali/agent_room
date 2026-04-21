import { createFileRoute } from '@tanstack/react-router'
import { GlobalActivityPage } from './-global-pages'
import { requireRouteUser } from './-route-auth'

export const Route = createFileRoute('/activity')({
    beforeLoad: requireRouteUser,
    component: GlobalActivityPage,
})
