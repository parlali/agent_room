import { readFileSync } from 'node:fs'
import type { D1Database, R2Bucket } from '@cloudflare/workers-types'
import { describe, expect, it } from 'vitest'
import type { AgentRoomHostedEnv } from './bindings'
import { ensureHostedSessionWorkspace, mapHostedSessionToActor } from './hosted-auth'
import {
    hostedConfigValues,
    hostedRequiredSecretNames,
    hostedSecretNames,
} from './hosted-config-contract'
import { resolveHostedConfig } from './hosted-config'
import { readHostedWorkspaceOwnerMembership } from './hosted-membership'
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
    return Array.from(
        text.matchAll(
            /([A-Z0-9_]+):\s*\$\{\{\s*secrets\.[A-Z0-9_]+(?:\s*\|\|\s*secrets\.[A-Z0-9_]+)?\s*\}\}/g,
        ),
    )
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
        AGENT_ROOM_BILLING_MODE: 'disabled',
        AGENT_ROOM_BILLING_PLANS:
            '[{"key":"starter","priceId":"price_test_starter_000000","monthlyCents":700,"includedCents":0},{"key":"standard","priceId":"price_test_standard_000000","monthlyCents":2000,"includedCents":1200},{"key":"pro","priceId":"price_test_pro_000000","monthlyCents":5000,"includedCents":3500}]',
        AGENT_ROOM_BILLING_USAGE_MARKUP_BPS: '13000',
        AGENT_ROOM_BILLING_TAX_MODE: 'automatic',
        AGENT_ROOM_BILLING_MAX_CONCURRENT_ROOMS: '3',
        AGENT_ROOM_RUNTIME_BACKEND: 'cloudflare-containers',
        AGENT_ROOM_RUNTIME_STORAGE: 'r2',
        BETTER_AUTH_SECRET: 'a'.repeat(32),
        BETTER_AUTH_URL: 'https://rooms.example.test',
        AGENT_ROOM_HOSTED_ENCRYPTION_KEY_B64: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
        GOOGLE_CLIENT_ID: 'google-client',
        GOOGLE_CLIENT_SECRET: 'google-secret',
        AGENT_ROOM_EMAIL_WEBHOOK_URL: 'https://mail.example.test/send',
        AGENT_ROOM_EMAIL_WEBHOOK_BEARER_TOKEN: 'b'.repeat(16),
        AGENT_ROOM_EMAIL_FROM: 'Agent Room <noreply@example.test>',
        AGENT_ROOM_HOSTED_OPENROUTER_API_KEY: 'openrouter-platform-key',
        ...overrides,
    }
}

function workspaceBootstrapDb(input: {
    ownerWorkspaceIds?: string[]
    sessionUserId?: string
    sessionId?: string
}): D1Database {
    const state = {
        ownerWorkspaceIds: [...(input.ownerWorkspaceIds ?? [])],
        organizations: [] as Array<{ id: string; slug: string }>,
        members: [] as Array<{ id: string; organizationId: string; userId: string; role: string }>,
        activeOrganizationId: null as string | null,
        sessionUserId: input.sessionUserId ?? 'user_1',
        sessionId: input.sessionId ?? 'session_1',
    }
    const execute = async (sql: string, args: unknown[]) => {
        if (/SELECT organizationId AS workspaceId\s+FROM member/.test(sql)) {
            return {
                results: state.ownerWorkspaceIds.slice(0, 2).map((workspaceId) => ({
                    workspaceId,
                })),
            }
        }
        if (/INSERT OR IGNORE INTO organization/.test(sql)) {
            state.organizations.push({
                id: String(args[0]),
                slug: String(args[1]),
            })
            return {
                meta: {
                    changes: 1,
                },
            }
        }
        if (/INSERT OR IGNORE INTO member/.test(sql)) {
            state.members.push({
                id: String(args[0]),
                organizationId: String(args[1]),
                userId: String(args[2]),
                role: 'owner',
            })
            state.ownerWorkspaceIds.push(String(args[1]))
            return {
                meta: {
                    changes: 1,
                },
            }
        }
        if (/UPDATE session/.test(sql)) {
            const workspaceId = String(args[0])
            const sessionId = String(args[2])
            const userId = String(args[3])
            const changes = sessionId === state.sessionId && userId === state.sessionUserId ? 1 : 0
            if (changes) {
                state.activeOrganizationId = workspaceId
            }
            return {
                meta: {
                    changes,
                },
            }
        }
        throw new Error(`Unexpected SQL: ${sql}`)
    }
    const prepare = (sql: string) => ({
        bind: (...args: unknown[]) => ({
            all: () => execute(sql, args),
            run: () => execute(sql, args),
        }),
    })
    return {
        prepare,
        batch: async (statements: Array<{ run: () => Promise<unknown> }>) => {
            const results = []
            for (const statement of statements) {
                results.push(await statement.run())
            }
            return results
        },
        dump: () => state,
    } as unknown as D1Database
}

describe('hosted Cloudflare configuration', () => {
    it('resolves the required hosted configuration', () => {
        expect(resolveHostedConfig(hostedEnv())).toMatchObject({
            authMode: 'better-auth',
            runtimeBackend: 'cloudflare-containers',
            runtimeStorage: 'r2',
            billing: {
                mode: 'disabled',
                plans: [
                    {
                        key: 'starter',
                        priceId: 'price_test_starter_000000',
                        monthlyCents: 700,
                        includedCents: 0,
                    },
                    {
                        key: 'standard',
                        priceId: 'price_test_standard_000000',
                        monthlyCents: 2000,
                        includedCents: 1200,
                    },
                    {
                        key: 'pro',
                        priceId: 'price_test_pro_000000',
                        monthlyCents: 5000,
                        includedCents: 3500,
                    },
                ],
                usageMarkupBps: 13000,
                taxMode: 'automatic',
                maxConcurrentRoomsPerWorkspace: 3,
                stripe: null,
            },
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

    it('requires the hosted encryption key to be valid 32-byte base64', () => {
        expect(() =>
            resolveHostedConfig(
                hostedEnv({
                    AGENT_ROOM_HOSTED_ENCRYPTION_KEY_B64: '@@@@',
                }),
            ),
        ).toThrow(/valid base64/)

        expect(() =>
            resolveHostedConfig(
                hostedEnv({
                    AGENT_ROOM_HOSTED_ENCRYPTION_KEY_B64: 'c2hvcnQ=',
                }),
            ),
        ).toThrow(/32 bytes/)
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

    it('requires Stripe secrets when Stripe billing is enabled', () => {
        expect(() =>
            resolveHostedConfig(
                hostedEnv({
                    AGENT_ROOM_BILLING_MODE: 'stripe',
                }),
            ),
        ).toThrow(/STRIPE_SECRET_KEY/)

        expect(
            resolveHostedConfig(
                hostedEnv({
                    AGENT_ROOM_BILLING_MODE: 'stripe',
                    STRIPE_SECRET_KEY: 'stripe-secret-test-value',
                    STRIPE_WEBHOOK_SECRET: 'stripe-webhook-test-value',
                    STRIPE_CREDIT_TOPUP_PRICE_ID: 'price_test_topup_000000',
                }),
            ).billing.stripe,
        ).toMatchObject({
            secretKey: 'stripe-secret-test-value',
            webhookSecret: 'stripe-webhook-test-value',
            creditTopupPriceId: 'price_test_topup_000000',
        })
    })

    it('resolves the configured billing plans and knobs in stripe mode', () => {
        const config = resolveHostedConfig(
            hostedEnv({
                AGENT_ROOM_BILLING_MODE: 'stripe',
                STRIPE_SECRET_KEY: 'stripe-secret-test-value',
                STRIPE_WEBHOOK_SECRET: 'stripe-webhook-test-value',
                STRIPE_CREDIT_TOPUP_PRICE_ID: 'price_test_topup_000000',
            }),
        )
        expect(config.billing.plans.map((plan) => plan.key)).toEqual(['starter', 'standard', 'pro'])
        expect(config.billing.usageMarkupBps).toBe(13000)
        expect(config.billing.taxMode).toBe('automatic')
        expect(config.billing.maxConcurrentRoomsPerWorkspace).toBe(3)
    })

    it('fails closed when stripe mode has no billing plans', () => {
        expect(() =>
            resolveHostedConfig(
                hostedEnv({
                    AGENT_ROOM_BILLING_MODE: 'stripe',
                    STRIPE_SECRET_KEY: 'stripe-secret-test-value',
                    STRIPE_WEBHOOK_SECRET: 'stripe-webhook-test-value',
                    STRIPE_CREDIT_TOPUP_PRICE_ID: 'price_test_topup_000000',
                    AGENT_ROOM_BILLING_PLANS: '[]',
                }),
            ),
        ).toThrow(/AGENT_ROOM_BILLING_PLANS/)
    })

    it('fails closed when a plan includes more usage than its monthly price', () => {
        expect(() =>
            resolveHostedConfig(
                hostedEnv({
                    AGENT_ROOM_BILLING_PLANS:
                        '[{"key":"bad","priceId":"price_bad","monthlyCents":700,"includedCents":1200}]',
                }),
            ),
        ).toThrow(/Invalid hosted Cloudflare configuration/)
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
        expect(workflowConfig).not.toContain('self-hosted:cloudflare:preview:delete')
        expect(workflowConfig).not.toContain('AGENT_ROOM_CLOUDFLARE_ALLOW_HOSTED_PRODUCTION_RESET')
        expect(extractWorkflowSecretEnvNames(previewWorkflowConfig)).toEqual(
            hostedSecretNames.filter((name) => name !== 'BETTER_AUTH_URL').sort(),
        )
        expect(previewWorkflowConfig).toContain('- opened')
        expect(previewWorkflowConfig).toContain('- synchronize')
        expect(previewWorkflowConfig).toContain('- reopened')
        expect(previewWorkflowConfig).not.toContain('- closed')
        expect(previewWorkflowConfig).not.toContain("github.event.action != 'closed'")
        expect(previewWorkflowConfig).toContain(
            'github.event.pull_request.head.repo.full_name == github.repository',
        )
        expect(previewWorkflowConfig).toContain(
            'run: bun run apps/self-hosted/scripts/cloudflare-hosted-preview-input.ts',
        )
        expect(previewWorkflowConfig).toContain(
            "ref: ${{ github.event_name == 'pull_request' && github.event.pull_request.head.sha || github.event.repository.default_branch }}",
        )
        expect(previewWorkflowConfig).toContain('ref: ${{ steps.preview.outputs.head_sha }}')
        expect(previewWorkflowConfig).not.toContain('ref: ${{ inputs.ref }}')
        expect(previewWorkflowConfig).not.toContain('self-hosted:cloudflare:preview:delete')
        expect(previewWorkflowConfig).toContain('BETTER_AUTH_URL: ${{ steps.preview.outputs.url }}')
        expect(previewWorkflowConfig).toContain(
            'BETTER_AUTH_SECRET: ${{ secrets.BETTER_AUTH_HOSTED_PREVIEW_SECRET || secrets.BETTER_AUTH_SECRET }}',
        )
        expect(previewWorkflowConfig).toContain(
            'AGENT_ROOM_HOSTED_ENCRYPTION_KEY_B64: ${{ secrets.AGENT_ROOM_HOSTED_PREVIEW_ENCRYPTION_KEY_B64 || secrets.AGENT_ROOM_HOSTED_ENCRYPTION_KEY_B64 }}',
        )
        expect(previewWorkflowConfig).toContain(
            'CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_HOSTED_PREVIEW_API_TOKEN || secrets.CLOUDFLARE_API_TOKEN }}',
        )
    })

    it('keeps Wrangler hosted vars aligned with the hosted config contract', () => {
        const wranglerConfig = readText(new URL('../../../wrangler.hosted.jsonc', import.meta.url))
        expect(wranglerConfig).toContain(`"AGENT_ROOM_AUTH_MODE": "${hostedConfigValues.authMode}"`)
        expect(wranglerConfig).toContain(
            `"AGENT_ROOM_BILLING_MODE": "${hostedConfigValues.billingMode}"`,
        )
        expect(wranglerConfig).toContain(`"AGENT_ROOM_BILLING_PLANS": "[]"`)
        expect(wranglerConfig).not.toMatch(new RegExp('price_[^"]*place' + 'holder'))
        expect(wranglerConfig).toContain(`"AGENT_ROOM_BILLING_USAGE_MARKUP_BPS": "13000"`)
        expect(wranglerConfig).toContain(`"AGENT_ROOM_BILLING_TAX_MODE": "automatic"`)
        expect(wranglerConfig).toContain(`"AGENT_ROOM_BILLING_MAX_CONCURRENT_ROOMS": "3"`)
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
                    id: 'session_1',
                    activeOrganizationId: 'workspace_1',
                    activeOrganizationRole: 'owner',
                },
            }),
        ).toEqual({
            authProvider: 'better-auth',
            userId: 'user_1',
            sessionId: 'session_1',
            email: 'user@example.test',
            workspaceId: 'workspace_1',
        })
    })

    it('rejects sessions without an active organization', () => {
        expect(
            mapHostedSessionToActor({
                user: {
                    id: 'user_1',
                    email: 'user@example.test',
                },
                session: {
                    id: 'session_1',
                },
            }),
        ).toBeNull()
    })
})

describe('hosted auth membership', () => {
    it('creates and activates a single owner workspace for a new hosted session', async () => {
        const db = workspaceBootstrapDb({})
        const env = hostedEnv({
            AGENT_ROOM_DB: db,
        })

        const workspaceId = await ensureHostedSessionWorkspace({
            env,
            userId: 'user_1',
            sessionId: 'session_1',
            activeWorkspaceId: null,
        })
        const state = (
            db as unknown as { dump: () => { activeOrganizationId: string | null } }
        ).dump()

        expect(workspaceId).toMatch(/^workspace_[a-f0-9]{40}$/)
        expect(state.activeOrganizationId).toBe(workspaceId)
    })

    it('allows only owner membership from D1 membership truth', async () => {
        const env = hostedEnv({
            AGENT_ROOM_DB: {
                prepare: () => ({
                    bind: () => ({
                        first: async () => ({
                            matchedOwnerCount: 1,
                            workspaceOwnerCount: 1,
                            workspaceNonOwnerCount: 0,
                            userOwnerWorkspaceCount: 1,
                        }),
                    }),
                }),
            } as unknown as D1Database,
        })

        await expect(
            readHostedWorkspaceOwnerMembership({
                env,
                userId: 'user_1',
                workspaceId: 'workspace_1',
            }),
        ).resolves.toBe(true)
    })

    it('fails closed when membership role is not owner', async () => {
        const env = hostedEnv({
            AGENT_ROOM_DB: {
                prepare: () => ({
                    bind: () => ({
                        first: async () => ({
                            matchedOwnerCount: 0,
                            workspaceOwnerCount: 1,
                            workspaceNonOwnerCount: 1,
                            userOwnerWorkspaceCount: 0,
                        }),
                    }),
                }),
            } as unknown as D1Database,
        })

        await expect(
            readHostedWorkspaceOwnerMembership({
                env,
                userId: 'user_1',
                workspaceId: 'workspace_1',
            }),
        ).resolves.toBe(false)
    })

    it('fails closed when workspace ownership is ambiguous', async () => {
        const env = hostedEnv({
            AGENT_ROOM_DB: {
                prepare: () => ({
                    bind: () => ({
                        first: async () => ({
                            matchedOwnerCount: 1,
                            workspaceOwnerCount: 2,
                            workspaceNonOwnerCount: 0,
                            userOwnerWorkspaceCount: 1,
                        }),
                    }),
                }),
            } as unknown as D1Database,
        })

        await expect(
            readHostedWorkspaceOwnerMembership({
                env,
                userId: 'user_1',
                workspaceId: 'workspace_1',
            }),
        ).resolves.toBe(false)
    })

    it('fails closed when user ownership is ambiguous', async () => {
        const env = hostedEnv({
            AGENT_ROOM_DB: {
                prepare: () => ({
                    bind: () => ({
                        first: async () => ({
                            matchedOwnerCount: 1,
                            workspaceOwnerCount: 1,
                            workspaceNonOwnerCount: 0,
                            userOwnerWorkspaceCount: 2,
                        }),
                    }),
                }),
            } as unknown as D1Database,
        })

        await expect(
            readHostedWorkspaceOwnerMembership({
                env,
                userId: 'user_1',
                workspaceId: 'workspace_1',
            }),
        ).resolves.toBe(false)
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
            }),
        ).toMatchObject({
            enableInternet: false,
            envVars: {
                AGENT_ROOM_HOSTED_WORKSPACE_ID: 'workspace_1',
                AGENT_ROOM_HOSTED_ROOM_ID: 'room_1',
            },
            labels: {
                workspace_id: 'workspace_1',
                room_id: 'room_1',
            },
        })
    })
})
