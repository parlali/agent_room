import { readFileSync } from 'node:fs'
import type { D1Database, R2Bucket } from '@cloudflare/workers-types'
import { describe, expect, it } from 'vitest'
import type { AgentRoomHostedEnv } from './bindings'
import { mapHostedSessionToActor } from './hosted-auth'
import {
    hostedConfigValues,
    hostedRequiredSecretNames,
    hostedSecretNames,
} from './hosted-config-contract'
import { resolveHostedConfig } from './hosted-config'
import { readHostedWorkspaceRole } from './hosted-membership'
import { buildHostedRuntimeStartOptions, hostedRuntimeContainerName } from './runtime-contract'

function readText(path: URL): string {
    return readFileSync(path, 'utf8')
}

function extractWranglerRequiredSecrets(text: string): string[] {
    const requiredIndex = text.indexOf('"required"')
    const openIndex = text.indexOf('[', requiredIndex)
    const closeIndex = text.indexOf(']', openIndex)
    return Array.from(text.slice(openIndex, closeIndex).matchAll(/"([A-Z0-9_]+)"/g))
        .map((match) => match[1])
        .sort()
}

function extractWorkflowSecretEnvNames(text: string): string[] {
    return Array.from(text.matchAll(/([A-Z0-9_]+):\s*\$\{\{\s*secrets\.([A-Z0-9_]+)\s*\}\}/g))
        .filter((match) => match[1] === match[2])
        .map((match) => match[1])
        .filter((name) => hostedSecretNames.includes(name as never))
        .sort()
}

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

    it('allows hosted auth without Google OAuth credentials', () => {
        expect(
            resolveHostedConfig(
                hostedEnv({
                    GOOGLE_CLIENT_ID: undefined,
                    GOOGLE_CLIENT_SECRET: undefined,
                }),
            ),
        ).toMatchObject({
            google: null,
        })
    })

    it('fails closed when Google OAuth credentials are partially configured', () => {
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

    it('requires HTTPS URLs for auth and email delivery endpoints', () => {
        expect(() =>
            resolveHostedConfig(
                hostedEnv({
                    BETTER_AUTH_URL: 'http://rooms.example.test',
                }),
            ),
        ).toThrow(/BETTER_AUTH_URL/)
        expect(() =>
            resolveHostedConfig(
                hostedEnv({
                    AGENT_ROOM_EMAIL_WEBHOOK_URL: 'http://mail.example.test/send',
                }),
            ),
        ).toThrow(/AGENT_ROOM_EMAIL_WEBHOOK_URL/)
    })

    it('keeps Wrangler and workflow secret inventories aligned with the hosted config contract', () => {
        const wranglerConfig = readText(new URL('../../../wrangler.hosted.jsonc', import.meta.url))
        const workflowConfig = readText(
            new URL(
                '../../../../../.github/workflows/cloudflare-hosted-deploy.yml',
                import.meta.url,
            ),
        )
        const previewWorkflowConfig = readText(
            new URL(
                '../../../../../.github/workflows/cloudflare-hosted-preview.yml',
                import.meta.url,
            ),
        )

        expect(extractWranglerRequiredSecrets(wranglerConfig)).toEqual(
            [...hostedRequiredSecretNames].sort(),
        )
        expect(extractWorkflowSecretEnvNames(workflowConfig)).toEqual([...hostedSecretNames].sort())
        expect(extractWorkflowSecretEnvNames(previewWorkflowConfig)).toEqual(
            hostedSecretNames.filter((name) => name !== 'BETTER_AUTH_URL').sort(),
        )
        expect(previewWorkflowConfig).toContain(
            'BETTER_AUTH_URL: https://agent-room-hosted-pr-${{ github.event.pull_request.number }}.${{ vars.CLOUDFLARE_WORKERS_SUBDOMAIN }}.workers.dev',
        )
    })

    it('keeps Wrangler hosted vars aligned with the hosted config contract', () => {
        const wranglerConfig = readText(new URL('../../../wrangler.hosted.jsonc', import.meta.url))
        expect(wranglerConfig).toContain(`"AGENT_ROOM_AUTH_MODE": "${hostedConfigValues.authMode}"`)
        expect(wranglerConfig).toContain(
            `"AGENT_ROOM_RUNTIME_BACKEND": "${hostedConfigValues.runtimeBackend}"`,
        )
        expect(wranglerConfig).toContain(
            `"AGENT_ROOM_RUNTIME_STORAGE": "${hostedConfigValues.runtimeStorage}"`,
        )
    })
})

describe('hosted auth actor mapping', () => {
    it('maps a Better Auth session with an active organization without trusting session role', () => {
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
            workspaceRole: null,
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

describe('hosted auth membership', () => {
    it('reads workspace role from D1 membership truth', async () => {
        const env = hostedEnv({
            AGENT_ROOM_DB: {
                prepare: () => ({
                    bind: () => ({
                        first: async () => ({
                            role: 'admin',
                        }),
                    }),
                }),
            } as unknown as D1Database,
        })

        await expect(
            readHostedWorkspaceRole({
                env,
                userId: 'user_1',
                workspaceId: 'workspace_1',
            }),
        ).resolves.toBe('admin')
    })

    it('fails closed when membership role is missing or unsupported', async () => {
        const env = hostedEnv({
            AGENT_ROOM_DB: {
                prepare: () => ({
                    bind: () => ({
                        first: async () => ({
                            role: 'viewer',
                        }),
                    }),
                }),
            } as unknown as D1Database,
        })

        await expect(
            readHostedWorkspaceRole({
                env,
                userId: 'user_1',
                workspaceId: 'workspace_1',
            }),
        ).resolves.toBeNull()
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
