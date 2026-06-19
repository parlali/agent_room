import { describe, expect, it } from 'vitest'
import type { AgentRoomHostedEnv } from './bindings'
import { mapHostedSessionToActor } from './hosted-auth'
import { resolveHostedConfig } from './hosted-config'
import { buildHostedRuntimeStartOptions, hostedRuntimeContainerName } from './runtime-contract'

function hostedEnv(overrides: Partial<AgentRoomHostedEnv> = {}): AgentRoomHostedEnv {
    return {
        AGENT_ROOM_DB: {} as D1Database,
        AGENT_ROOM_WORKSPACE_BUCKET: {} as R2Bucket,
        AGENT_ROOM_RUNTIME_JOBS: {} as AgentRoomHostedEnv['AGENT_ROOM_RUNTIME_JOBS'],
        AGENT_ROOM_RUNTIME: {} as AgentRoomHostedEnv['AGENT_ROOM_RUNTIME'],
        AGENT_ROOM_AUTH_MODE: 'better-auth',
        AGENT_ROOM_RUNTIME_BACKEND: 'cloudflare-containers',
        AGENT_ROOM_RUNTIME_STORAGE: 'r2',
        BETTER_AUTH_SECRET: 'a'.repeat(32),
        BETTER_AUTH_URL: 'https://rooms.example.test',
        GOOGLE_CLIENT_ID: 'google-client',
        GOOGLE_CLIENT_SECRET: 'google-secret',
        AGENT_ROOM_EMAIL_WEBHOOK_URL: 'https://mail.example.test/send',
        AGENT_ROOM_EMAIL_WEBHOOK_BEARER_TOKEN: 'b'.repeat(16),
        AGENT_ROOM_EMAIL_FROM: 'Agent Room <noreply@example.test>',
        ...overrides,
    }
}

describe('hosted Cloudflare configuration', () => {
    it('resolves the required hosted configuration', () => {
        expect(resolveHostedConfig(hostedEnv())).toMatchObject({
            authMode: 'better-auth',
            runtimeBackend: 'cloudflare-containers',
            runtimeStorage: 'r2',
            publicOrigin: 'https://rooms.example.test',
            google: {
                clientId: 'google-client',
                clientSecret: 'google-secret',
            },
        })
    })

    it('fails closed when Better Auth is not explicitly enabled', () => {
        expect(() =>
            resolveHostedConfig(
                hostedEnv({
                    AGENT_ROOM_AUTH_MODE: 'local',
                }),
            ),
        ).toThrow(/Invalid hosted Cloudflare configuration/)
    })

    it('requires Google OAuth credentials for hosted auth', () => {
        expect(() =>
            resolveHostedConfig(
                hostedEnv({
                    GOOGLE_CLIENT_SECRET: '',
                }),
            ),
        ).toThrow(/GOOGLE_CLIENT_SECRET/)
    })

    it('requires the email webhook used by verification and reset flows', () => {
        expect(() =>
            resolveHostedConfig(
                hostedEnv({
                    AGENT_ROOM_EMAIL_WEBHOOK_BEARER_TOKEN: '',
                }),
            ),
        ).toThrow(/AGENT_ROOM_EMAIL_WEBHOOK_BEARER_TOKEN/)
    })
})

describe('hosted auth actor mapping', () => {
    it('maps a Better Auth session with an active organization to a hosted actor', () => {
        expect(
            mapHostedSessionToActor({
                user: {
                    id: 'user_1',
                    email: 'user@example.test',
                },
                session: {
                    activeOrganizationId: 'workspace_1',
                    activeOrganizationRole: 'owner',
                },
            }),
        ).toEqual({
            authProvider: 'better-auth',
            userId: 'user_1',
            email: 'user@example.test',
            workspaceId: 'workspace_1',
            workspaceRole: 'owner',
        })
    })

    it('rejects sessions without an active organization', () => {
        expect(
            mapHostedSessionToActor({
                user: {
                    id: 'user_1',
                    email: 'user@example.test',
                },
                session: {},
            }),
        ).toBeNull()
    })
})

describe('hosted runtime container options', () => {
    it('names containers by workspace and room', () => {
        expect(
            hostedRuntimeContainerName({
                workspaceId: 'workspace_1',
                roomId: 'room_1',
            }),
        ).toBe('workspace:workspace_1:room:room_1')
    })

    it('rejects unsafe container identifiers', () => {
        expect(() =>
            hostedRuntimeContainerName({
                workspaceId: '../workspace',
                roomId: 'room_1',
            }),
        ).toThrow(/workspaceId/)
    })

    it('builds fail-closed runtime start options without D1 credentials', () => {
        expect(
            buildHostedRuntimeStartOptions({
                workspaceId: 'workspace_1',
                roomId: 'room_1',
                runtimeConfigPath: '/workspace/runtime/pi-runtime.config.json',
                runtimeToken: 'runtime-token',
                controlPlaneOrigin: 'https://rooms.example.test',
            }),
        ).toMatchObject({
            enableInternet: false,
            envVars: {
                AGENT_ROOM_HOSTED_WORKSPACE_ID: 'workspace_1',
                AGENT_ROOM_HOSTED_ROOM_ID: 'room_1',
                AGENT_ROOM_HOSTED_CONTROL_PLANE_ORIGIN: 'https://rooms.example.test',
            },
            labels: {
                workspace_id: 'workspace_1',
                room_id: 'room_1',
            },
        })
    })
})
