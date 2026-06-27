import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useRouterState } from '@tanstack/react-router'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'

import { TooltipProvider } from '#/components/ui/tooltip'
import { AppShell } from '#/components/app-shell'
import { roomQueryPolicy } from '#/lib/room-query-keys'
import {
    afterNextPaint,
    observeLongTasks,
    recordClientPerformance,
    routePathFromPathname,
} from '#/lib/browser-performance'

export function AppProviders(props: { children: ReactNode }) {
    const [queryClient] = useState(
        () =>
            new QueryClient({
                defaultOptions: {
                    queries: {
                        staleTime: roomQueryPolicy.warmStaleMs,
                        gcTime: roomQueryPolicy.retainedSessionMs,
                        refetchOnWindowFocus: false,
                    },
                },
            }),
    )

    return (
        <QueryClientProvider client={queryClient}>
            <TooltipProvider delayDuration={150}>
                <BrowserPerformanceProbe />
                <PersistentAppShell>{props.children}</PersistentAppShell>
            </TooltipProvider>
        </QueryClientProvider>
    )
}

function PersistentAppShell({ children }: { children: ReactNode }) {
    const pathname = useRouterState({
        select: (state) => state.location.pathname,
    })
    const shellEnabled = useMemo(() => shouldUsePersistentShell(pathname), [pathname])

    if (!shellEnabled) {
        return children
    }

    return <AppShell>{children}</AppShell>
}

function BrowserPerformanceProbe() {
    const pathname = useRouterState({
        select: (state) => state.location.pathname,
    })
    const mountedAtRef = useRef(performance.now())
    const mountLoggedRef = useRef(false)
    const roomId = roomIdFromPath(pathname)
    const sessionKey = sessionKeyFromPath(pathname)

    useEffect(() => {
        const startedAt = performance.now()
        return afterNextPaint(() => {
            if (pathname === '/login') return
            recordClientPerformance({
                name: 'navigation.paint',
                roomId,
                sessionKey,
                routePath: routePathFromPathname(pathname),
                durationMs: performance.now() - startedAt,
            })
        })
    }, [pathname, roomId, sessionKey])

    useEffect(() => {
        if (mountLoggedRef.current) return
        if (pathname === '/login') return
        mountLoggedRef.current = true
        const navigation = performance.getEntriesByType('navigation')[0] as
            | PerformanceNavigationTiming
            | undefined
        recordClientPerformance({
            name: 'document.navigation',
            roomId,
            sessionKey,
            routePath: routePathFromPathname(pathname),
            navigationType: navigation?.type ?? 'unknown',
            durationMs: performance.now() - mountedAtRef.current,
        })
    }, [pathname, roomId, sessionKey])

    useEffect(() => {
        return observeLongTasks({
            roomId: () => roomIdFromPath(window.location.pathname),
            sessionKey: () => sessionKeyFromPath(window.location.pathname),
        })
    }, [])

    useEffect(() => {
        const onPageShow = (event: PageTransitionEvent) => {
            recordClientPerformance({
                name: 'document.navigation',
                roomId: roomIdFromPath(window.location.pathname),
                sessionKey: sessionKeyFromPath(window.location.pathname),
                routePath: routePathFromPathname(window.location.pathname),
                navigationType: event.persisted ? 'bfcache' : 'pageshow',
            })
        }
        window.addEventListener('pageshow', onPageShow)
        return () => window.removeEventListener('pageshow', onPageShow)
    }, [])

    useEffect(() => {
        recordClientPerformance({
            name: 'route.remount',
            roomId,
            sessionKey,
            routePath: routePathFromPathname(pathname),
            durationMs: performance.now() - mountedAtRef.current,
        })
    }, [pathname, roomId, sessionKey])

    return null
}

function shouldUsePersistentShell(pathname: string): boolean {
    if (pathname === '/login' || pathname === '/onboarding' || pathname === '/billing') {
        return false
    }
    if (
        pathname.startsWith('/api/') ||
        pathname.startsWith('/_serverFn/') ||
        pathname.startsWith('/assets/')
    ) {
        return false
    }
    return true
}

function sessionKeyFromPath(pathname: string): string | null {
    const match = pathname.match(/^\/rooms\/[^/]+\/sessions\/([^/]+)/)
    if (!match) return null
    try {
        return decodeURIComponent(match[1]!)
    } catch {
        return match[1]!
    }
}

function roomIdFromPath(pathname: string): string | null {
    const match = pathname.match(/^\/rooms\/([^/]+)/)
    return match ? match[1]! : null
}
