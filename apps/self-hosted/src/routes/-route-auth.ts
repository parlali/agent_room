import { redirect } from '@tanstack/react-router'
import { routeAuthServer, type RouteAuthSnapshot } from './-auth-server'
import { createRouteAuthCache } from './-route-auth-cache'

interface RouteUserOptions {
    requireHostedSubscription?: boolean
}

const routeAuthCacheTtlMs = 30_000

const routeAuthCache = createRouteAuthCache<RouteAuthSnapshot>({
    fetchSnapshot: () => routeAuthServer(),
    hasUser: (snapshot) => snapshot.user !== null,
    ttlMs: routeAuthCacheTtlMs,
})

export function clearRouteAuthCache(): void {
    routeAuthCache.clear()
}

function readRouteAuthSnapshot(): Promise<RouteAuthSnapshot> {
    if (typeof document === 'undefined') {
        return routeAuthServer()
    }
    return routeAuthCache.read()
}

function routeUserOptions(input: unknown): RouteUserOptions {
    if (!input || typeof input !== 'object' || !('requireHostedSubscription' in input)) {
        return {}
    }
    const value = (input as RouteUserOptions).requireHostedSubscription
    return typeof value === 'boolean' ? { requireHostedSubscription: value } : {}
}

export async function requireRouteUser(input?: unknown) {
    const options = routeUserOptions(input)
    const snapshot = await readRouteAuthSnapshot()
    if (!snapshot.user) {
        clearRouteAuthCache()
        throw redirect({
            to: '/login',
        })
    }
    if (options.requireHostedSubscription === false) {
        return snapshot.user
    }
    if (snapshot.billing && !snapshot.billing.active) {
        throw redirect({
            to: '/billing',
            search: {
                checkout: null,
            },
        })
    }
    return snapshot.user
}
