import { parse } from 'cookie'
import { getAppEnv } from '../config/env'
import { validateSessionToken } from './auth-service'
import { isSameOrigin, resolveEffectiveRequestUrl, sessionCookieName } from './session-auth'

export async function requireApiSession(request: Request): Promise<boolean> {
    const cookies = parse(request.headers.get('cookie') ?? '')
    const token = cookies[sessionCookieName]?.trim()
    if (!token) {
        return false
    }

    return (await validateSessionToken(token)) !== null
}

export function assertApiSameOriginMutation(request: Request): Response | null {
    const method = request.method.toUpperCase()
    if (method !== 'POST' && method !== 'PUT' && method !== 'PATCH' && method !== 'DELETE') {
        return null
    }

    const source = request.headers.get('origin') ?? request.headers.get('referer')
    if (!source) {
        return new Response('Mutation request missing origin metadata', {
            status: 403,
        })
    }

    const targetUrl = resolveEffectiveRequestUrl(request.url, getAppEnv().publicOrigin)
    if (!isSameOrigin(source, targetUrl)) {
        return new Response('Cross-origin mutation request blocked', {
            status: 403,
        })
    }

    return null
}
