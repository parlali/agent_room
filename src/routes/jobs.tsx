import { createFileRoute } from '@tanstack/react-router'
import { GlobalJobsPage } from './-global-pages'
import { requireRouteUser } from './-route-auth'

export const Route = createFileRoute('/jobs')({
    beforeLoad: requireRouteUser,
    component: GlobalJobsPage,
})
