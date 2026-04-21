import { createFileRoute } from '@tanstack/react-router'
import { GlobalFilesPage } from './-global-pages'
import { requireRouteUser } from './-route-auth'

export const Route = createFileRoute('/files')({
    beforeLoad: requireRouteUser,
    component: GlobalFilesPage,
})
