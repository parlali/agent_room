import { randomBytes } from 'node:crypto'
import { getAppEnv } from '../config/env'
import {
    userRepository,
    sessionRepository,
    auditRepository,
    sessionComposerDraftRepository,
} from '../db/repositories'
import { hashPassword, hashSessionToken, verifyPassword } from '../security/password'

const sessionTouchThrottleMs = 60_000
const sessionTouchCache = new Map<string, number>()

export interface AuthenticatedSession {
    token: string
    userId: string
    email: string
    role: 'root' | 'operator'
    expiresAt: Date
}

function assertLocalAuthEnabled() {
    if (getAppEnv().authMode !== 'local') {
        throw new Error('Local password authentication is disabled for this auth mode')
    }
}

export async function bootstrapRootUser() {
    assertLocalAuthEnabled()
    const env = getAppEnv()

    const totalUsers = await userRepository.countUsers()
    if (totalUsers > 0) {
        return {
            created: false,
        }
    }

    const user = await userRepository.createUser({
        email: env.rootEmail,
        passwordHash: hashPassword(env.rootPassword),
        role: 'root',
    })

    await auditRepository.appendEvent({
        actorUserId: user.id,
        roomId: null,
        action: 'auth.root_bootstrapped',
        payload: { email: user.email },
    })

    return {
        created: true,
        userId: user.id,
        email: user.email,
    }
}

export async function loginWithPassword(input: {
    email: string
    password: string
    userAgent?: string | null
    ipAddress?: string | null
}): Promise<AuthenticatedSession> {
    assertLocalAuthEnabled()
    const env = getAppEnv()

    const user = await userRepository.findByEmail(input.email)
    if (!user || !verifyPassword(input.password, user.passwordHash)) {
        throw new Error('Invalid credentials')
    }

    const rawToken = randomBytes(32).toString('base64url')
    const tokenHash = hashSessionToken(rawToken)
    const expiresAt = new Date(Date.now() + env.sessionTtlHours * 60 * 60 * 1000)

    await sessionRepository.createSession({
        userId: user.id,
        tokenHash,
        expiresAt,
        userAgent: input.userAgent ?? null,
        ipAddress: input.ipAddress ?? null,
    })

    await auditRepository.appendEvent({
        actorUserId: user.id,
        roomId: null,
        action: 'auth.login',
        payload: {
            email: user.email,
            sessionExpiresAt: expiresAt.toISOString(),
        },
    })

    return {
        token: rawToken,
        userId: user.id,
        email: user.email,
        role: user.role,
        expiresAt,
    }
}

export async function validateSessionToken(token: string) {
    const tokenHash = hashSessionToken(token)
    const session = await sessionRepository.findActiveByTokenHash(tokenHash, new Date())
    if (!session) {
        return null
    }
    const user = await userRepository.findById(session.userId)
    if (!user) {
        return null
    }
    await touchSessionThrottled({
        tokenHash,
        sessionId: session.id,
    })
    return {
        user,
        session,
    }
}

export async function revokeSession(token: string) {
    const tokenHash = hashSessionToken(token)
    const session = await sessionRepository.findActiveByTokenHash(tokenHash, new Date())
    if (!session) {
        return
    }
    await sessionRepository.revokeSession(session.id, new Date())
    await sessionComposerDraftRepository.deleteByAuthSession(session.id)
    await auditRepository.appendEvent({
        actorUserId: session.userId,
        roomId: null,
        action: 'auth.logout',
        payload: { sessionId: session.id },
    })
}

async function touchSessionThrottled(input: {
    tokenHash: string
    sessionId: string
}): Promise<void> {
    const now = Date.now()
    const lastTouchedAt = sessionTouchCache.get(input.tokenHash) ?? 0
    if (now - lastTouchedAt < sessionTouchThrottleMs) {
        return
    }
    sessionTouchCache.set(input.tokenHash, now)
    await sessionRepository.touchSession(input.sessionId, new Date(now))
}
