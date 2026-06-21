import { betterAuth } from 'better-auth'
import { organization } from 'better-auth/plugins'
import type { AgentRoomHostedEnv } from './bindings'
import { sendHostedAuthEmail } from './hosted-email'
import { resolveHostedConfig } from './hosted-config'
import { readHostedWorkspaceRole } from './hosted-membership'

export type HostedWorkspaceRole = 'owner' | 'admin' | 'member'

export interface HostedActor {
    authProvider: 'better-auth'
    userId: string
    email: string
    workspaceId: string
    workspaceRole: HostedWorkspaceRole | null
}

function invitationUrl(publicOrigin: string, invitationId: string): string {
    const url = new URL('/organization/accept-invitation', publicOrigin)
    url.searchParams.set('id', invitationId)
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
            autoSignInAfterVerification: false,
            sendVerificationEmail: async ({ user, url }) => {
                await sendHostedAuthEmail(env, {
                    purpose: 'email_verification',
                    to: user.email,
                    subject: 'Verify your Agent Room email',
                    actionUrl: url,
                    metadata: {
                        userId: user.id,
                    },
                })
            },
        },
        ...(socialProviders ? { socialProviders } : {}),
        plugins: [
            organization({
                creatorRole: 'owner',
                membershipLimit: 100,
                requireEmailVerificationOnInvitation: true,
                teams: {
                    enabled: false,
                },
                sendInvitationEmail: async (data) => {
                    await sendHostedAuthEmail(env, {
                        purpose: 'organization_invitation',
                        to: data.email,
                        subject: `Join ${data.organization.name} on Agent Room`,
                        actionUrl: invitationUrl(config.publicOrigin, data.id),
                        metadata: {
                            invitationId: data.id,
                            organizationId: data.organization.id,
                            inviterId: data.inviter.userId,
                            role: data.role,
                        },
                    })
                },
            }),
        ],
    })
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
    const workspaceId = readStringField(session, 'activeOrganizationId')
    if (!userId || !email || !workspaceId) {
        return null
    }

    return {
        authProvider: 'better-auth',
        userId,
        email,
        workspaceId,
        workspaceRole: null,
    }
}

export async function readHostedActorFromRequest(
    env: AgentRoomHostedEnv,
    request: Request,
): Promise<HostedActor | null> {
    const session = await getHostedAuth(env).api.getSession({
        headers: request.headers,
    })
    const actor = mapHostedSessionToActor(session)
    if (!actor) {
        return null
    }
    const workspaceRole = await readHostedWorkspaceRole({
        env,
        userId: actor.userId,
        workspaceId: actor.workspaceId,
    })
    if (!workspaceRole) {
        return null
    }
    return {
        ...actor,
        workspaceRole,
    }
}
