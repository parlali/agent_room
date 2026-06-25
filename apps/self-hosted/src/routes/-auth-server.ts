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
import { isHostedBillingPlanStatusActive } from '#/server/cloudflare/hosted-billing-types'

const loginInputSchema = z.object({
    email: z.email(),
    password: z.string().min(1),
})

const signupInputSchema = z.object({
    email: z.email(),
    password: z.string().min(12),
    name: z.string().trim().min(1).max(120),
})

export interface AuthUserSnapshot {
    userId: string
    email: string
    role: 'root' | 'operator'
}

export interface AuthSurfaceSnapshot {
    hosted: boolean
    signupEnabled: boolean
}

export interface HostedBillingAccessSnapshot {
    hosted: true
    active: boolean
    planKey: string
    planStatus: string
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

function hostedAuthErrorMessage(payload: unknown, fallback: string): string {
    if (!payload || typeof payload !== 'object') {
        return fallback
    }
    const record = payload as Record<string, unknown>
    return typeof record.message === 'string' && record.message.trim() ? record.message : fallback
}

export const authSurfaceServer = createServerFn({ method: 'GET' }).handler(async () => {
    setResponseHeaders({
        'cache-control': 'no-store',
    })
    const hosted = readHostedRequestContext()
    return {
        hosted: Boolean(hosted),
        signupEnabled: Boolean(hosted),
    } satisfies AuthSurfaceSnapshot
})

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

export const hostedBillingAccessServer = createServerFn({ method: 'GET' }).handler(async () => {
    setResponseHeaders({
        'cache-control': 'no-store',
    })
    const hosted = readHostedRequestContext()
    if (!hosted) {
        return null
    }
    const actor = await readHostedContextActor(hosted)
    if (!actor) {
        return null
    }
    const { ensureHostedBillingAccount } =
        await import('#/server/cloudflare/hosted-billing-repository')
    const account = await ensureHostedBillingAccount({
        env: hosted.env,
        workspaceId: actor.workspaceId,
    })
    return {
        hosted: true,
        active: isHostedBillingPlanStatusActive(account.planStatus),
        planKey: account.planKey,
        planStatus: account.planStatus,
    } satisfies HostedBillingAccessSnapshot
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

export const signupServer = createServerFn({ method: 'POST' })
    .inputValidator((input: unknown) => signupInputSchema.parse(input))
    .handler(async ({ data }) => {
        const hosted = readHostedRequestContext()
        if (!hosted) {
            throw new Error('Hosted signup is not available in this deployment')
        }
        assertHostedSameOriginMutation(getRequest(), hosted.env)
        const response = await getHostedAuth(hosted.env).handler(
            new Request(new URL('/api/auth/sign-up/email', hosted.request.url), {
                method: 'POST',
                headers: {
                    'content-type': 'application/json',
                    origin: new URL(hosted.request.url).origin,
                },
                body: JSON.stringify({
                    email: data.email.trim().toLowerCase(),
                    password: data.password,
                    name: data.name.trim(),
                    callbackURL: new URL('/billing', hosted.request.url).toString(),
                }),
            }),
        )
        if (!response.ok) {
            let payload: unknown = null
            try {
                payload = await response.json()
            } catch {}
            throw new Error(hostedAuthErrorMessage(payload, 'Could not create account'))
        }
        const setCookies = response.headers.getSetCookie()
        if (setCookies.length > 0) {
            setResponseHeader('set-cookie', setCookies)
        }
        return {
            ok: true,
            email: data.email.trim().toLowerCase(),
        }
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
