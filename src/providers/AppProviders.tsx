import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useRouterState } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'

import { TooltipProvider } from '#/components/ui/tooltip'
import { recordClientPerformanceServer } from '#/routes/-room-runtime-server'

export function AppProviders(props: { children: ReactNode }) {
    const [queryClient] = useState(
        () =>
            new QueryClient({
                defaultOptions: {
                    queries: {
                        staleTime: 10_000,
                        refetchOnWindowFocus: false,
                    },
                },
            }),
    )

    return (
        <QueryClientProvider client={queryClient}>
            <TooltipProvider delayDuration={150}>
                <NavigationPaintProbe />
                {props.children}
            </TooltipProvider>
        </QueryClientProvider>
    )
}

function NavigationPaintProbe() {
    const pathname = useRouterState({
        select: (state) => state.location.pathname,
    })

    useEffect(() => {
        const startedAt = performance.now()
        let cancelled = false
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                if (cancelled || pathname === '/login') return
                void recordClientPerformanceServer({
                    data: {
                        name: 'navigation.paint',
                        roomId: roomIdFromPath(pathname),
                        sessionKey: null,
                        durationMs: performance.now() - startedAt,
                    },
                }).catch(() => {})
            })
        })
        return () => {
            cancelled = true
        }
    }, [pathname])

    return null
}

function roomIdFromPath(pathname: string): string | null {
    const match = pathname.match(/^\/rooms\/([^/]+)/)
    return match ? match[1]! : null
}
