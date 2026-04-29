import { createRouter as createTanStackRouter } from '@tanstack/react-router'

import { routeTree } from './routeTree.gen'
import { ErrorFallback, NotFound } from './components/agent-room'

export function getRouter() {
    const router = createTanStackRouter({
        routeTree,
        scrollRestoration: true,
        defaultPreload: 'intent',
        defaultPreloadStaleTime: 0,
        defaultErrorComponent: ({ error, reset }) => <ErrorFallback error={error} reset={reset} />,
        defaultNotFoundComponent: () => <NotFound />,
    })

    return router
}

declare module '@tanstack/react-router' {
    interface Register {
        router: ReturnType<typeof getRouter>
    }
}
