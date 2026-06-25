import { redirect } from '@tanstack/react-router'
import { currentUserServer, hostedBillingAccessServer } from './-auth-server'

interface RouteUserOptions {
    requireHostedSubscription?: boolean
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
    const user = await currentUserServer()
    if (!user) {
        throw redirect({
            to: '/login',
        })
    }
    if (options.requireHostedSubscription === false) {
        return user
    }
    const billing = await hostedBillingAccessServer()
    if (billing && !billing.active) {
        throw redirect({
            to: '/billing',
            search: {
                checkout: null,
            },
        })
    }
    return user
}
