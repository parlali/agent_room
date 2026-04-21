import { randomBytes } from 'node:crypto'
import { getAppEnv } from '../config/env'
import { userRepository, sessionRepository, auditRepository } from '../db/repositories'
import { hashPassword, hashSessionToken, verifyPassword } from '../security/password'

const env = getAppEnv()

export interface AuthenticatedSession {
    token: string
    userId: string
    email: string
    role: 'root' | 'operator'
    expiresAt: Date
}

export async function bootstrapRootUser() {
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
    await sessionRepository.touchSession(session.id, new Date())
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
    await auditRepository.appendEvent({
        actorUserId: session.userId,
        roomId: null,
        action: 'auth.logout',
        payload: { sessionId: session.id },
    })
}
