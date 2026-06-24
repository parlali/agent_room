import { parse } from 'cookie'
import { getAppEnv } from '../config/env'
import { validateSessionToken } from './auth-service'
import {
    isSameOrigin,
    resolveEffectiveRequestUrl,
    sessionCookieName,
    type AuthenticatedActor,
} from './session-auth'

export async function readApiSessionActor(request: Request): Promise<AuthenticatedActor | null> {
    const cookies = parse(request.headers.get('cookie') ?? '')
    const token = cookies[sessionCookieName]?.trim()
    if (!token) {
        return null
    }

    const validated = await validateSessionToken(token)
    if (!validated) {
        return null
    }

    return {
        userId: validated.user.id,
        email: validated.user.email,
        role: validated.user.role,
        sessionId: validated.session.id,
    }
}

export async function requireApiSession(request: Request): Promise<boolean> {
    return (await readApiSessionActor(request)) !== null
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
