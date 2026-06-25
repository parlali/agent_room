import { APIError, betterAuth } from 'better-auth'
import { organization } from 'better-auth/plugins'
import type { AgentRoomHostedEnv } from './bindings'
import { sendHostedAuthEmail } from './hosted-email'
import { resolveHostedConfig } from './hosted-config'
import { readHostedWorkspaceOwnerMembership } from './hosted-membership'

export interface HostedActor {
    authProvider: 'better-auth'
    userId: string
    sessionId: string
    email: string
    workspaceId: string
}

export function hostedVerifiedEmailBillingUrl(input: {
    verificationUrl: string
    publicOrigin: string
}): string {
    const url = new URL(input.verificationUrl)
    url.searchParams.set('callbackURL', new URL('/billing', input.publicOrigin).toString())
    return url.toString()
}

export function createHostedAuth(env: AgentRoomHostedEnv) {
    const config = resolveHostedConfig(env)
    const socialProviders = config.google
        ? {
              google: {
                  clientId: config.google.clientId,
                  clientSecret: config.google.clientSecret,
              },
          }
        : undefined

    return betterAuth({
        database: env.AGENT_ROOM_DB,
        secret: config.betterAuthSecret,
        baseURL: config.betterAuthUrl,
        trustedOrigins: [config.publicOrigin],
        emailAndPassword: {
            enabled: true,
            requireEmailVerification: true,
            minPasswordLength: 12,
            sendResetPassword: async ({ user, url }) => {
                await sendHostedAuthEmail(env, {
                    purpose: 'password_reset',
                    to: user.email,
                    subject: 'Reset your Agent Room password',
                    actionUrl: url,
                    metadata: {
                        userId: user.id,
                    },
                })
            },
        },
        emailVerification: {
            sendOnSignUp: true,
            autoSignInAfterVerification: true,
            sendVerificationEmail: async ({ user, url }) => {
                await sendHostedAuthEmail(env, {
                    purpose: 'email_verification',
                    to: user.email,
                    subject: 'Verify your Agent Room email',
                    actionUrl: hostedVerifiedEmailBillingUrl({
                        verificationUrl: url,
                        publicOrigin: config.publicOrigin,
                    }),
                    metadata: {
                        userId: user.id,
                    },
                })
            },
        },
        ...(socialProviders ? { socialProviders } : {}),
        plugins: [
            organization({
                allowUserToCreateOrganization: true,
                creatorRole: 'owner',
                organizationLimit: 1,
                membershipLimit: 1,
                invitationLimit: 0,
                requireEmailVerificationOnInvitation: true,
                disableOrganizationDeletion: true,
                teams: {
                    enabled: false,
                },
                organizationHooks: {
                    beforeAddMember: async ({ member }) => {
                        if (member.role !== 'owner') {
                            throw new APIError('FORBIDDEN', {
                                message: 'Hosted workspaces support owner-only access',
                            })
                        }
                    },
                    beforeUpdateMemberRole: async () => {
                        throw new APIError('FORBIDDEN', {
                            message: 'Hosted workspace roles are not supported',
                        })
                    },
                    beforeCreateInvitation: async () => {
                        throw new APIError('FORBIDDEN', {
                            message: 'Hosted workspace invitations are not supported',
                        })
                    },
                    beforeAcceptInvitation: async () => {
                        throw new APIError('FORBIDDEN', {
                            message: 'Hosted workspace invitations are not supported',
                        })
                    },
                },
            }),
        ],
    })
}

async function hostedWorkspaceHash(value: string): Promise<string> {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
    return Array.from(new Uint8Array(digest))
        .map((byte) => byte.toString(16).padStart(2, '0'))
        .join('')
}

async function deterministicHostedWorkspaceIds(userId: string): Promise<{
    workspaceId: string
    workspaceSlug: string
    memberId: string
}> {
    const hash = await hostedWorkspaceHash(userId)
    return {
        workspaceId: `workspace_${hash.slice(0, 40)}`,
        workspaceSlug: `workspace-${hash.slice(0, 32)}`,
        memberId: `member_${hash.slice(0, 40)}`,
    }
}

async function readHostedOwnerWorkspaceIds(input: {
    env: AgentRoomHostedEnv
    userId: string
}): Promise<string[]> {
    const rows = await input.env.AGENT_ROOM_DB.prepare(
        `
            SELECT organizationId AS workspaceId
            FROM member
            WHERE userId = ?1
              AND role = 'owner'
            ORDER BY createdAt ASC
            LIMIT 2
        `,
    )
        .bind(input.userId)
        .all<{ workspaceId: string }>()
    return rows.results.map((row) => row.workspaceId)
}

async function setHostedSessionActiveWorkspace(input: {
    env: AgentRoomHostedEnv
    userId: string
    sessionId: string
    workspaceId: string
}): Promise<void> {
    const result = await input.env.AGENT_ROOM_DB.prepare(
        `
            UPDATE session
            SET activeOrganizationId = ?1,
                updatedAt = ?2
            WHERE id = ?3
              AND userId = ?4
        `,
    )
        .bind(input.workspaceId, new Date().toISOString(), input.sessionId, input.userId)
        .run()
    if (!result.meta || result.meta.changes < 1) {
        throw new Error('Hosted session no longer exists')
    }
}

export async function ensureHostedSessionWorkspace(input: {
    env: AgentRoomHostedEnv
    userId: string
    sessionId: string
    activeWorkspaceId: string | null
}): Promise<string> {
    if (input.activeWorkspaceId) {
        return input.activeWorkspaceId
    }

    const existingWorkspaceIds = await readHostedOwnerWorkspaceIds({
        env: input.env,
        userId: input.userId,
    })
    if (existingWorkspaceIds.length > 1) {
        throw new Error('Hosted user has multiple owner workspaces')
    }
    if (existingWorkspaceIds[0]) {
        await setHostedSessionActiveWorkspace({
            env: input.env,
            userId: input.userId,
            sessionId: input.sessionId,
            workspaceId: existingWorkspaceIds[0],
        })
        return existingWorkspaceIds[0]
    }

    const ids = await deterministicHostedWorkspaceIds(input.userId)
    const now = new Date().toISOString()
    try {
        await input.env.AGENT_ROOM_DB.batch([
            input.env.AGENT_ROOM_DB.prepare(
                `
                    INSERT OR IGNORE INTO organization (
                        id,
                        name,
                        slug,
                        logo,
                        createdAt,
                        metadata
                    )
                    VALUES (?1, 'Personal workspace', ?2, NULL, ?3, '{}')
                `,
            ).bind(ids.workspaceId, ids.workspaceSlug, now),
            input.env.AGENT_ROOM_DB.prepare(
                `
                    INSERT OR IGNORE INTO member (
                        id,
                        organizationId,
                        userId,
                        role,
                        createdAt
                    )
                    VALUES (?1, ?2, ?3, 'owner', ?4)
                `,
            ).bind(ids.memberId, ids.workspaceId, input.userId, now),
        ])
    } catch (error) {
        const racedWorkspaceIds = await readHostedOwnerWorkspaceIds({
            env: input.env,
            userId: input.userId,
        })
        if (racedWorkspaceIds.length !== 1) {
            throw error
        }
        await setHostedSessionActiveWorkspace({
            env: input.env,
            userId: input.userId,
            sessionId: input.sessionId,
            workspaceId: racedWorkspaceIds[0],
        })
        return racedWorkspaceIds[0]
    }
    const createdWorkspaceIds = await readHostedOwnerWorkspaceIds({
        env: input.env,
        userId: input.userId,
    })
    if (createdWorkspaceIds.length !== 1) {
        throw new Error('Hosted user workspace bootstrap did not produce one owner workspace')
    }
    await setHostedSessionActiveWorkspace({
        env: input.env,
        userId: input.userId,
        sessionId: input.sessionId,
        workspaceId: createdWorkspaceIds[0],
    })
    return createdWorkspaceIds[0]
}

type HostedAuth = ReturnType<typeof createHostedAuth>

const hostedAuthByEnv = new WeakMap<AgentRoomHostedEnv, HostedAuth>()

export function getHostedAuth(env: AgentRoomHostedEnv): HostedAuth {
    const cached = hostedAuthByEnv.get(env)
    if (cached) {
        return cached
    }
    const auth = createHostedAuth(env)
    hostedAuthByEnv.set(env, auth)
    return auth
}

function readStringField(value: unknown, field: string): string | null {
    if (!value || typeof value !== 'object') {
        return null
    }
    const record = value as Record<string, unknown>
    const fieldValue = record[field]
    return typeof fieldValue === 'string' && fieldValue.trim() ? fieldValue : null
}

export function mapHostedSessionToActor(sessionPayload: unknown): HostedActor | null {
    if (!sessionPayload || typeof sessionPayload !== 'object') {
        return null
    }

    const payload = sessionPayload as Record<string, unknown>
    const user = payload.user
    const session = payload.session
    const userId = readStringField(user, 'id')
    const email = readStringField(user, 'email')
    const sessionId = readStringField(session, 'id')
    const workspaceId = readStringField(session, 'activeOrganizationId')
    if (!userId || !sessionId || !email || !workspaceId) {
        return null
    }

    return {
        authProvider: 'better-auth',
        userId,
        sessionId,
        email,
        workspaceId,
    }
}

export async function readHostedActorFromRequest(
    env: AgentRoomHostedEnv,
    request: Request,
): Promise<HostedActor | null> {
    const session = await getHostedAuth(env).api.getSession({
        headers: request.headers,
    })
    if (!session || typeof session !== 'object') {
        return null
    }
    const payload = session as Record<string, unknown>
    const user = payload.user
    const sessionRecord = payload.session
    const userId = readStringField(user, 'id')
    const email = readStringField(user, 'email')
    const sessionId = readStringField(sessionRecord, 'id')
    if (!userId || !email || !sessionId) {
        return null
    }
    const workspaceId = await ensureHostedSessionWorkspace({
        env,
        userId,
        sessionId,
        activeWorkspaceId: readStringField(sessionRecord, 'activeOrganizationId'),
    })
    const actor: HostedActor = {
        authProvider: 'better-auth',
        userId,
        sessionId,
        email,
        workspaceId,
    }
    const ownsWorkspace = await readHostedWorkspaceOwnerMembership({
        env,
        userId: actor.userId,
        workspaceId: actor.workspaceId,
    })
    if (!ownsWorkspace) {
        return null
    }
    return actor
}
