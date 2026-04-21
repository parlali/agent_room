import {
    getRequest,
    getCookie,
    setCookie,
    deleteCookie,
    setResponseStatus,
} from '@tanstack/react-start/server'
import type { UserRole } from '../domain/types'
import { validateSessionToken } from './auth-service'

export const sessionCookieName = 'agent_room_session'

export interface AuthenticatedActor {
    userId: string
    email: string
    role: UserRole
    sessionId: string
}

function isLoopbackHost(hostname: string): boolean {
    const normalized = hostname.toLowerCase()
    return normalized === 'localhost' || normalized === '127.0.0.1' || normalized === '::1'
}

function isSameOrigin(sourceUrl: string, targetUrl: string): boolean {
    try {
        const source = new URL(sourceUrl)
        const target = new URL(targetUrl)
        return source.protocol === target.protocol && source.host === target.host
    } catch {
        return false
    }
}

function resolveCookieSecureFlag(requestUrl: string): boolean {
    const url = new URL(requestUrl)
    if (url.protocol === 'https:') {
        return true
    }
    return !isLoopbackHost(url.hostname)
}

function resolveCookieMaxAge(expiresAt: Date): number {
    const secondsUntilExpiry = Math.floor((expiresAt.getTime() - Date.now()) / 1000)
    return Math.max(0, secondsUntilExpiry)
}

export function getSessionTokenFromCookie(): string | null {
    const token = getCookie(sessionCookieName)
    if (!token) {
        return null
    }
    const trimmed = token.trim()
    return trimmed ? trimmed : null
}

export function writeSessionCookie(token: string, expiresAt: Date): void {
    const request = getRequest()
    setCookie(sessionCookieName, token, {
        path: '/',
        httpOnly: true,
        sameSite: 'lax',
        secure: resolveCookieSecureFlag(request.url),
        maxAge: resolveCookieMaxAge(expiresAt),
    })
}

export function clearSessionCookie(): void {
    const request = getRequest()
    deleteCookie(sessionCookieName, {
        path: '/',
        httpOnly: true,
        sameSite: 'lax',
        secure: resolveCookieSecureFlag(request.url),
    })
}

export async function readAuthenticatedActor(): Promise<AuthenticatedActor | null> {
    const token = getSessionTokenFromCookie()
    if (!token) {
        return null
    }

    const validated = await validateSessionToken(token)
    if (!validated) {
        clearSessionCookie()
        return null
    }

    return {
        userId: validated.user.id,
        email: validated.user.email,
        role: validated.user.role,
        sessionId: validated.session.id,
    }
}

export async function requireAuthenticatedActor(): Promise<AuthenticatedActor> {
    const actor = await readAuthenticatedActor()
    if (!actor) {
        setResponseStatus(401, 'Unauthorized')
        throw new Error('Authentication required')
    }
    return actor
}

export function assertSameOriginMutation(): void {
    const request = getRequest()
    const method = request.method.toUpperCase()
    if (method !== 'POST' && method !== 'PUT' && method !== 'PATCH' && method !== 'DELETE') {
        return
    }

    const originHeader = request.headers.get('origin')
    const refererHeader = request.headers.get('referer')
    const sourceHeader = originHeader ?? refererHeader
    if (!sourceHeader) {
        setResponseStatus(403, 'Forbidden')
        throw new Error('Mutation request missing origin metadata')
    }

    if (!isSameOrigin(sourceHeader, request.url)) {
        setResponseStatus(403, 'Forbidden')
        throw new Error('Cross-origin mutation request blocked')
    }
}

export const __testing = {
    isLoopbackHost,
    isSameOrigin,
    resolveCookieSecureFlag,
    resolveCookieMaxAge,
}
