import { createServerFn } from '@tanstack/react-start'
import { getRequest, getRequestIP, setResponseHeaders } from '@tanstack/react-start/server'
import { z } from 'zod'
import { loginWithPassword, revokeSession } from '#/server/auth/auth-service'
import {
    assertSameOriginMutation,
    clearSessionCookie,
    getSessionTokenFromCookie,
    readAuthenticatedActor,
    writeSessionCookie,
} from '#/server/auth/session-auth'

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
    const actor = await readAuthenticatedActor()
    if (!actor) {
        return null
    }
    return toUserSnapshot(actor)
})

export const loginServer = createServerFn({ method: 'POST' })
    .inputValidator((input: unknown) => loginInputSchema.parse(input))
    .handler(async ({ data }) => {
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
