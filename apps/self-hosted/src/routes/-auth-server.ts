import { createServerFn } from '@tanstack/react-start'
import {
    getRequest,
    getRequestIP,
    setResponseHeader,
    setResponseHeaders,
} from '@tanstack/react-start/server'
import { z } from 'zod'
import { getHostedAuth } from '#/server/cloudflare/hosted-auth'
import { readHostedRequestContext } from '#/server/cloudflare/hosted-request-context'
import {
    assertHostedSameOriginMutation,
    readHostedContextActor,
} from '#/server/cloudflare/hosted-route-auth'

const loginInputSchema = z.object({
    email: z.email(),
    password: z.string().min(1),
})

export interface AuthUserSnapshot {
    userId: string
    email: string
    role: 'root' | 'operator'
}

function toUserSnapshot(input: {
    userId: string
    email: string
    role: 'root' | 'operator'
}): AuthUserSnapshot {
    return {
        userId: input.userId,
        email: input.email,
        role: input.role,
    }
}

export const currentUserServer = createServerFn({ method: 'GET' }).handler(async () => {
    setResponseHeaders({
        'cache-control': 'no-store',
    })
    const hosted = readHostedRequestContext()
    if (hosted) {
        const actor = await readHostedContextActor(hosted)
        if (!actor) {
            return null
        }
        return toUserSnapshot({
            userId: actor.userId,
            email: actor.email,
            role: 'operator',
        })
    }
    const { readAuthenticatedActor } = await import('#/server/auth/session-auth')
    const actor = await readAuthenticatedActor()
    if (!actor) {
        return null
    }
    return toUserSnapshot(actor)
})

export const loginServer = createServerFn({ method: 'POST' })
    .inputValidator((input: unknown) => loginInputSchema.parse(input))
    .handler(async ({ data }) => {
        const hosted = readHostedRequestContext()
        if (hosted) {
            assertHostedSameOriginMutation(getRequest(), hosted.env)
            const response = await getHostedAuth(hosted.env).handler(
                new Request(new URL('/api/auth/sign-in/email', hosted.request.url), {
                    method: 'POST',
                    headers: {
                        'content-type': 'application/json',
                        origin: new URL(hosted.request.url).origin,
                    },
                    body: JSON.stringify({
                        email: data.email.trim().toLowerCase(),
                        password: data.password,
                        rememberMe: true,
                    }),
                }),
            )
            if (!response.ok) {
                console.warn('Hosted sign-in rejected by auth handler', response.status)
                throw new Error('Invalid email or password')
            }
            const setCookies = response.headers.getSetCookie()
            if (setCookies.length > 0) {
                setResponseHeader('set-cookie', setCookies)
            }
            const payload = (await response.json()) as {
                user?: {
                    id?: unknown
                    email?: unknown
                }
            }
            const user = payload.user
            if (!user || typeof user.id !== 'string' || typeof user.email !== 'string') {
                console.warn('Hosted sign-in returned an invalid user payload')
                throw new Error('Hosted sign-in response was invalid')
            }
            return toUserSnapshot({
                userId: user.id,
                email: user.email,
                role: 'operator',
            })
        }
        const { assertSameOriginMutation, writeSessionCookie } =
            await import('#/server/auth/session-auth')
        const { loginWithPassword } = await import('#/server/auth/auth-service')
        assertSameOriginMutation()
        const request = getRequest()
        const session = await loginWithPassword({
            email: data.email.trim().toLowerCase(),
            password: data.password,
            userAgent: request.headers.get('user-agent'),
            ipAddress: getRequestIP({
                xForwardedFor: true,
            }),
        })
        writeSessionCookie(session.token, session.expiresAt)
        return toUserSnapshot(session)
    })

export const logoutServer = createServerFn({ method: 'POST' }).handler(async () => {
    const hosted = readHostedRequestContext()
    if (hosted) {
        assertHostedSameOriginMutation(getRequest(), hosted.env)
        const response = await getHostedAuth(hosted.env).handler(
            new Request(new URL('/api/auth/sign-out', hosted.request.url), {
                method: 'POST',
                headers: hosted.request.headers,
            }),
        )
        const setCookies = response.headers.getSetCookie()
        if (setCookies.length > 0) {
            setResponseHeader('set-cookie', setCookies)
        }
        return {
            ok: true,
        }
    }
    const { assertSameOriginMutation, clearSessionCookie, getSessionTokenFromCookie } =
        await import('#/server/auth/session-auth')
    const { revokeSession } = await import('#/server/auth/auth-service')
    assertSameOriginMutation()
    const token = getSessionTokenFromCookie()
    if (token) {
        await revokeSession(token)
    }
    clearSessionCookie()
    return {
        ok: true,
    }
})
