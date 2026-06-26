import type { AgentRoomHostedEnv } from './bindings'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
    hostedRuntimeWorkerRoute,
    runtimeUsageIdempotencyKey,
} from './hosted-worker-runtime-routes'
import { HostedBillingBalanceExhaustedError } from './hosted-billing-types'

const mocks = vi.hoisted(() => ({
    HostedBillingReservationAlreadyExistsError: class HostedBillingReservationAlreadyExistsError extends Error {
        constructor() {
            super('Hosted billing reservation idempotency key already exists')
            this.name = 'HostedBillingReservationAlreadyExistsError'
        }
    },
    getHostedRuntimeEndpointState: vi.fn(),
    getHostedWorkspaceSettings: vi.fn(),
    readHostedRuntimeToken: vi.fn(),
    recordHostedRuntimeUsageEvent: vi.fn(),
    recordHostedProviderUsage: vi.fn(),
    recordHostedProviderUsageBlocked: vi.fn(),
    upsertHostedRoomRuntimeFile: vi.fn(),
    putHostedRuntimeStateFile: vi.fn(),
    deleteHostedRuntimeStateFile: vi.fn(),
    ensureHostedBillingAccount: vi.fn(),
    authorizeHostedBillingReservation: vi.fn(),
    releaseHostedBillingReservation: vi.fn(),
    findHostedBillingReservationByIdempotencyKey: vi.fn(),
    readHostedProviderUsageSettlementByIdempotencyKey: vi.fn(),
    recordHostedBrowserbaseSession: vi.fn(),
    readHostedBrowserbaseSession: vi.fn(),
    readHostedBrowserbaseSessionByUsageRequestId: vi.fn(),
    requestHostedBrowserbaseSessionRelease: vi.fn(),
    markHostedBrowserbaseSessionReleased: vi.fn(),
    readHostedRoomConfig: vi.fn(),
    listRoomMcpBindings: vi.fn(),
}))

vi.mock('./hosted-room-service', () => ({
    getHostedRuntimeEndpointState: mocks.getHostedRuntimeEndpointState,
    getHostedWorkspaceSettings: mocks.getHostedWorkspaceSettings,
}))

vi.mock('./hosted-runtime-client', () => ({
    readHostedRuntimeToken: mocks.readHostedRuntimeToken,
}))

vi.mock('./hosted-usage-billing', () => ({
    recordHostedRuntimeUsageEvent: mocks.recordHostedRuntimeUsageEvent,
    recordHostedProviderUsage: mocks.recordHostedProviderUsage,
    recordHostedProviderUsageBlocked: mocks.recordHostedProviderUsageBlocked,
}))

vi.mock('./hosted-file-store', () => ({
    upsertHostedRoomRuntimeFile: mocks.upsertHostedRoomRuntimeFile,
}))

vi.mock('./hosted-runtime-state-store', () => ({
    putHostedRuntimeStateFile: mocks.putHostedRuntimeStateFile,
    deleteHostedRuntimeStateFile: mocks.deleteHostedRuntimeStateFile,
}))

vi.mock('./hosted-billing-repository', () => ({
    HostedBillingReservationAlreadyExistsError: mocks.HostedBillingReservationAlreadyExistsError,
    ensureHostedBillingAccount: mocks.ensureHostedBillingAccount,
    authorizeHostedBillingReservation: mocks.authorizeHostedBillingReservation,
    releaseHostedBillingReservation: mocks.releaseHostedBillingReservation,
    findHostedBillingReservationByIdempotencyKey:
        mocks.findHostedBillingReservationByIdempotencyKey,
    readHostedProviderUsageSettlementByIdempotencyKey:
        mocks.readHostedProviderUsageSettlementByIdempotencyKey,
    recordHostedBrowserbaseSession: mocks.recordHostedBrowserbaseSession,
    readHostedBrowserbaseSession: mocks.readHostedBrowserbaseSession,
    readHostedBrowserbaseSessionByUsageRequestId:
        mocks.readHostedBrowserbaseSessionByUsageRequestId,
    requestHostedBrowserbaseSessionRelease: mocks.requestHostedBrowserbaseSessionRelease,
    markHostedBrowserbaseSessionReleased: mocks.markHostedBrowserbaseSessionReleased,
}))

vi.mock('./hosted-room-config-store', () => ({
    readHostedRoomConfig: mocks.readHostedRoomConfig,
    listRoomMcpBindings: mocks.listRoomMcpBindings,
}))

const validToken = 'runtime-token-value-123456'

function hostedEnv(): AgentRoomHostedEnv {
    return {
        AGENT_ROOM_DB: {
            prepare: () => ({
                bind: (...args: unknown[]) => ({
                    first: async () => (args[2] === 'job_1' ? { id: 'job_1' } : null),
                }),
            }),
        } as unknown as AgentRoomHostedEnv['AGENT_ROOM_DB'],
        AGENT_ROOM_WORKSPACE_BUCKET: {} as AgentRoomHostedEnv['AGENT_ROOM_WORKSPACE_BUCKET'],
        AGENT_ROOM_RUNTIME_JOBS: {} as AgentRoomHostedEnv['AGENT_ROOM_RUNTIME_JOBS'],
        AGENT_ROOM_RUNTIME: {} as AgentRoomHostedEnv['AGENT_ROOM_RUNTIME'],
        AGENT_ROOM_AUTH_MODE: 'better-auth',
        AGENT_ROOM_BILLING_USAGE_MARKUP_BPS: '13000',
        AGENT_ROOM_BILLING_TAX_MODE: 'automatic',
        AGENT_ROOM_BILLING_MAX_CONCURRENT_ROOMS: '3',
        AGENT_ROOM_RUNTIME_BACKEND: 'cloudflare-containers',
        AGENT_ROOM_RUNTIME_STORAGE: 'r2',
        BETTER_AUTH_SECRET: 'a'.repeat(32),
        BETTER_AUTH_URL: 'https://rooms.example.test',
        AGENT_ROOM_HOSTED_ENCRYPTION_KEY_B64: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
        AGENT_ROOM_HOSTED_OPENROUTER_API_KEY: 'openrouter-test-key',
        AGENT_ROOM_HOSTED_BRAVE_API_KEY: 'brave-platform-key',
        AGENT_ROOM_HOSTED_BROWSERBASE_API_KEY: 'browserbase-platform-key',
        STRIPE_SECRET_KEY: 'stripe-secret-test-value',
        STRIPE_WEBHOOK_SECRET: 'stripe-webhook-test-value',
        AGENT_ROOM_EMAIL_WEBHOOK_URL: 'https://mail.example.test/send',
        AGENT_ROOM_EMAIL_WEBHOOK_BEARER_TOKEN: 'b'.repeat(16),
        AGENT_ROOM_EMAIL_FROM: 'Agent Room <noreply@example.test>',
    }
}

function runtimeEndpoint(
    input: {
        workspaceId?: string
        roomId?: string
        desiredState?: string
        status?: string
        tokenObjectKey?: string | null
        providerCandidate?: 'user_key' | 'codex' | 'hosted_openrouter' | null
    } = {},
) {
    const now = new Date(0).toISOString()
    return {
        desiredState: input.desiredState ?? 'running',
        status: input.status ?? 'running',
        runtime: {
            roomId: input.roomId ?? 'room_1',
            workspaceId: input.workspaceId ?? 'workspace_1',
            containerName: 'container_1',
            configObjectKey: 'config-key',
            tokenObjectKey: input.tokenObjectKey === undefined ? 'token-key' : input.tokenObjectKey,
            runtimeBundleObjectKey: 'bundle-key',
            providerCandidate:
                input.providerCandidate === undefined
                    ? 'hosted_openrouter'
                    : input.providerCandidate,
            workspaceSnapshotKey: null,
            configVersion: 1,
            tokenVersion: 1,
            healthStatus: 'healthy',
            startedAt: now,
            lastHealthAt: now,
            lastError: null,
            updatedAt: now,
        },
    }
}

async function callRoute(input: {
    path: string
    body?: unknown
    token?: string | null
    method?: string
    headers?: Record<string, string>
}): Promise<Response> {
    const headers = new Headers({
        'content-type': 'application/json',
    })
    for (const [name, value] of Object.entries(input.headers ?? {})) {
        headers.set(name, value)
    }
    if (input.token !== null) {
        headers.set('authorization', `Bearer ${input.token ?? validToken}`)
    }
    const response = await hostedRuntimeWorkerRoute({
        env: hostedEnv(),
        request: new Request(`https://rooms.example.test${input.path}`, {
            method: input.method ?? 'POST',
            headers,
            body: input.method === 'GET' ? undefined : JSON.stringify(input.body),
        }),
        url: new URL(`https://rooms.example.test${input.path}`),
    })
    if (!response) {
        throw new Error(`No hosted runtime route matched ${input.path}`)
    }
    return response
}

async function expectJsonCode(response: Response, status: number, code: string): Promise<void> {
    expect(response.status).toBe(status)
    await expect(response.json()).resolves.toMatchObject({
        ok: false,
        code,
    })
}

function openRouterRuntimeHeaders(headers: Record<string, string> = {}): Record<string, string> {
    return {
        'x-agent-room-usage-request-id': 'usage-request-123456',
        'x-agent-room-session-key': 'thread_1',
        'x-agent-room-run-id': 'run_1',
        'x-agent-room-job-id': 'job_1',
        ...headers,
    }
}

function braveRuntimeHeaders(headers: Record<string, string> = {}): Record<string, string> {
    return {
        ...openRouterRuntimeHeaders(),
        'x-subscription-token': validToken,
        ...headers,
    }
}

function browserbaseRuntimeHeaders(headers: Record<string, string> = {}): Record<string, string> {
    return {
        ...openRouterRuntimeHeaders(),
        'x-bb-api-key': validToken,
        ...headers,
    }
}

describe('hosted runtime usage idempotency keys', () => {
    it('does not persist callback payload JSON when runtime seq is missing', () => {
        const first = runtimeUsageIdempotencyKey({
            workspaceId: 'workspace_1',
            roomId: 'room_1',
            entry: {
                ts: 1,
                event: 'run.finished',
                sessionKey: 'thread_1',
                payload: {
                    sensitiveFixture: 'sample value one',
                    runId: 'run_1',
                },
            },
        })
        const second = runtimeUsageIdempotencyKey({
            workspaceId: 'workspace_1',
            roomId: 'room_1',
            entry: {
                ts: 1,
                event: 'run.finished',
                sessionKey: 'thread_1',
                payload: {
                    sensitiveFixture: 'sample value two',
                    runId: 'run_1',
                },
            },
        })

        expect(first).toBe(second)
        expect(first).not.toContain('sensitiveFixture')
        expect(first).not.toContain('sample value one')
        expect(first).toContain('missing-seq')
    })
})

describe('hosted runtime worker route security gates', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        mocks.getHostedRuntimeEndpointState.mockResolvedValue(runtimeEndpoint())
        mocks.readHostedRuntimeToken.mockResolvedValue(validToken)
        mocks.recordHostedRuntimeUsageEvent.mockResolvedValue({
            persisted: true,
            usageEventId: 'usage_1',
            debitedCents: 0,
            ledgerEntryId: null,
        })
        mocks.recordHostedProviderUsage.mockResolvedValue({
            usageEventId: 'usage_provider_1',
            debitedCents: 1,
            ledgerEntryId: 'ledger_1',
        })
        mocks.recordHostedProviderUsageBlocked.mockResolvedValue('usage_blocked_1')
        mocks.ensureHostedBillingAccount.mockResolvedValue({
            workspaceId: 'workspace_1',
            planKey: 'pro',
            planStatus: 'active',
            availableBalanceCents: 100,
        })
        mocks.findHostedBillingReservationByIdempotencyKey.mockResolvedValue(null)
        mocks.readHostedProviderUsageSettlementByIdempotencyKey.mockResolvedValue(null)
        mocks.recordHostedBrowserbaseSession.mockResolvedValue(undefined)
        mocks.readHostedBrowserbaseSession.mockResolvedValue({
            browserbaseSessionId: 'bb-session-1',
            workspaceId: 'workspace_1',
            roomId: 'room_1',
            sessionKey: 'thread_1',
            runId: 'run_1',
            jobId: 'job_1',
            usageRequestId: 'usage-request-123456',
            status: 'active',
            createdAt: new Date(0).toISOString(),
            updatedAt: new Date(0).toISOString(),
            releasedAt: null,
        })
        mocks.requestHostedBrowserbaseSessionRelease.mockResolvedValue(true)
        mocks.markHostedBrowserbaseSessionReleased.mockResolvedValue(undefined)
        mocks.readHostedBrowserbaseSessionByUsageRequestId.mockResolvedValue(null)
        mocks.authorizeHostedBillingReservation.mockResolvedValue({
            id: 'reservation_1',
        })
        mocks.upsertHostedRoomRuntimeFile.mockResolvedValue({
            surface: 'workspace',
            relativePath: 'file.txt',
        })
        mocks.putHostedRuntimeStateFile.mockResolvedValue({
            relativePath: 'state.json',
            operation: 'upsert',
        })
        mocks.deleteHostedRuntimeStateFile.mockResolvedValue({
            relativePath: 'state.json',
            operation: 'delete',
        })
        mocks.getHostedWorkspaceSettings.mockResolvedValue({
            searchConfig: {},
            capabilityDefaults: {},
        })
        mocks.readHostedRoomConfig.mockResolvedValue({
            roomId: 'room_1',
            instructions: '',
            providerMode: 'app_default',
            providerConnectionId: null,
            roomMode: 'coworker',
            capabilityOverrides: {},
            imageProvider: null,
            imageModel: null,
            imageSecretId: null,
            cronTimezone: 'UTC',
            browserActionBudget: 50,
            createdAt: new Date(0),
            updatedAt: new Date(0),
        })
        mocks.listRoomMcpBindings.mockResolvedValue([])
    })

    afterEach(() => {
        vi.unstubAllGlobals()
    })

    it.each(['/api/hosted/runtime/usage', '/api/hosted/runtime/file', '/api/hosted/runtime/state'])(
        'rejects missing runtime bearer tokens for %s',
        async (path) => {
            const response = await callRoute({
                path,
                token: null,
                body: {
                    workspaceId: 'workspace_1',
                    roomId: 'room_1',
                },
            })

            await expectJsonCode(response, 403, 'runtime_token_invalid')
            expect(mocks.recordHostedRuntimeUsageEvent).not.toHaveBeenCalled()
            expect(mocks.upsertHostedRoomRuntimeFile).not.toHaveBeenCalled()
            expect(mocks.putHostedRuntimeStateFile).not.toHaveBeenCalled()
            expect(mocks.deleteHostedRuntimeStateFile).not.toHaveBeenCalled()
        },
    )

    it('rejects bad runtime bearer tokens before persisting usage', async () => {
        const response = await callRoute({
            path: '/api/hosted/runtime/usage',
            token: 'wrong-runtime-token-123456',
            body: {
                workspaceId: 'workspace_1',
                roomId: 'room_1',
                entry: {
                    ts: 1,
                    seq: 1,
                    event: 'run.finished',
                },
            },
        })

        await expectJsonCode(response, 403, 'runtime_token_invalid')
        expect(mocks.recordHostedRuntimeUsageEvent).not.toHaveBeenCalled()
    })

    it('rejects callbacks when the runtime token object is missing', async () => {
        mocks.getHostedRuntimeEndpointState.mockResolvedValue(
            runtimeEndpoint({
                tokenObjectKey: null,
            }),
        )

        const response = await callRoute({
            path: '/api/hosted/runtime/usage',
            body: {
                workspaceId: 'workspace_1',
                roomId: 'room_1',
            },
        })

        await expectJsonCode(response, 403, 'runtime_token_invalid')
        expect(mocks.readHostedRuntimeToken).not.toHaveBeenCalled()
        expect(mocks.recordHostedRuntimeUsageEvent).not.toHaveBeenCalled()
    })

    it('rejects callbacks for stopped runtimes', async () => {
        mocks.getHostedRuntimeEndpointState.mockResolvedValue(
            runtimeEndpoint({
                desiredState: 'stopped',
                status: 'stopped',
            }),
        )

        const response = await callRoute({
            path: '/api/hosted/runtime/usage',
            body: {
                workspaceId: 'workspace_1',
                roomId: 'room_1',
            },
        })

        await expectJsonCode(response, 409, 'runtime_not_running')
        expect(mocks.readHostedRuntimeToken).not.toHaveBeenCalled()
        expect(mocks.recordHostedRuntimeUsageEvent).not.toHaveBeenCalled()
    })

    it('binds callbacks to the requested workspace and room token', async () => {
        const roomAToken = 'room-a-runtime-token-123'
        const roomBToken = 'room-b-runtime-token-123'
        mocks.getHostedRuntimeEndpointState.mockImplementation(
            async (input: { workspaceId: string; roomId: string }) =>
                runtimeEndpoint({
                    workspaceId: input.workspaceId,
                    roomId: input.roomId,
                    tokenObjectKey: `${input.workspaceId}:${input.roomId}:token`,
                }),
        )
        mocks.readHostedRuntimeToken.mockImplementation(
            async (input: { tokenObjectKey: string }) =>
                input.tokenObjectKey === 'workspace_2:room_2:token' ? roomBToken : roomAToken,
        )

        const response = await callRoute({
            path: '/api/hosted/runtime/usage',
            token: roomAToken,
            body: {
                workspaceId: 'workspace_2',
                roomId: 'room_2',
                entry: {
                    ts: 1,
                    seq: 1,
                    event: 'run.finished',
                },
            },
        })

        await expectJsonCode(response, 403, 'runtime_token_invalid')
        expect(mocks.getHostedRuntimeEndpointState).toHaveBeenCalledWith({
            env: expect.anything(),
            workspaceId: 'workspace_2',
            roomId: 'room_2',
        })
        expect(mocks.recordHostedRuntimeUsageEvent).not.toHaveBeenCalled()
    })

    it('rejects OpenRouter proxy requests when the runtime was materialized for another provider', async () => {
        const fetchMock = vi.fn(async () => new Response('{}'))
        vi.stubGlobal('fetch', fetchMock)
        mocks.getHostedRuntimeEndpointState.mockResolvedValue(
            runtimeEndpoint({
                providerCandidate: 'user_key',
            }),
        )

        const response = await callRoute({
            path: '/api/hosted/runtime/provider/openrouter/v1/workspaces/workspace_1/rooms/room_1/chat/completions',
            body: {
                model: 'openrouter/test-model',
                messages: [],
            },
        })

        await expectJsonCode(response, 403, 'runtime_provider_not_authorized')
        expect(fetchMock).not.toHaveBeenCalled()
        expect(mocks.ensureHostedBillingAccount).not.toHaveBeenCalled()
    })

    it('requires a stable usage request id for OpenRouter proxy requests', async () => {
        const fetchMock = vi.fn(async () => new Response('{}'))
        vi.stubGlobal('fetch', fetchMock)

        const response = await callRoute({
            path: '/api/hosted/runtime/provider/openrouter/v1/workspaces/workspace_1/rooms/room_1/chat/completions',
            body: {
                model: 'openrouter/test-model',
                messages: [],
            },
        })

        await expectJsonCode(response, 400, 'runtime_usage_request_id_required')
        expect(fetchMock).not.toHaveBeenCalled()
        expect(mocks.ensureHostedBillingAccount).not.toHaveBeenCalled()
    })

    it('repairs duplicate OpenRouter proxy settlement without calling the provider again', async () => {
        const fetchMock = vi.fn(async () => new Response('{}'))
        vi.stubGlobal('fetch', fetchMock)
        mocks.readHostedProviderUsageSettlementByIdempotencyKey.mockResolvedValue({
            id: 'usage_existing',
            roomId: 'room_1',
            sessionKey: 'thread_1',
            runId: 'run_1',
            jobId: 'job_1',
            provider: 'openrouter',
            model: 'openrouter/test-model',
            costMicros: 123456,
            billingStatus: 'debited',
            billingLedgerEntryId: 'ledger_1',
        })
        mocks.findHostedBillingReservationByIdempotencyKey.mockResolvedValue({
            id: 'reservation_1',
            roomId: 'room_1',
            provider: 'openrouter',
            status: 'authorized',
        })

        const response = await callRoute({
            path: '/api/hosted/runtime/provider/openrouter/v1/workspaces/workspace_1/rooms/room_1/chat/completions',
            headers: openRouterRuntimeHeaders(),
            body: {
                model: 'openrouter/test-model',
                messages: [],
            },
        })

        await expectJsonCode(response, 409, 'runtime_usage_request_already_recorded')
        expect(fetchMock).not.toHaveBeenCalled()
        expect(mocks.recordHostedProviderUsage).toHaveBeenCalledWith(
            expect.objectContaining({
                workspaceId: 'workspace_1',
                roomId: 'room_1',
                sessionKey: 'thread_1',
                runId: 'run_1',
                jobId: 'job_1',
                provider: 'openrouter',
                model: 'openrouter/test-model',
                costMicros: 123456,
                billingReservationId: 'reservation_1',
                idempotencyKey: 'provider_proxy:openrouter:workspace_1:room_1:usage-request-123456',
                metadata: expect.objectContaining({
                    settlementRepair: true,
                }),
            }),
        )
        expect(mocks.ensureHostedBillingAccount).not.toHaveBeenCalled()
    })

    it('repairs duplicate Brave proxy settlement without calling the provider again', async () => {
        const fetchMock = vi.fn(async () => new Response('{}'))
        vi.stubGlobal('fetch', fetchMock)
        mocks.readHostedProviderUsageSettlementByIdempotencyKey.mockResolvedValue({
            id: 'usage_existing',
            roomId: 'room_1',
            sessionKey: 'thread_1',
            runId: 'run_1',
            jobId: 'job_1',
            provider: 'brave',
            model: 'brave-search',
            costMicros: 10000,
            billingStatus: 'debited',
            billingLedgerEntryId: 'ledger_1',
        })
        mocks.findHostedBillingReservationByIdempotencyKey.mockResolvedValue({
            id: 'reservation_1',
            roomId: 'room_1',
            provider: 'brave',
            status: 'authorized',
        })

        const response = await callRoute({
            method: 'GET',
            path: '/api/hosted/runtime/provider/brave/v1/workspaces/workspace_1/rooms/room_1/res/v1/web/search?q=agent',
            headers: braveRuntimeHeaders(),
            token: null,
        })

        await expectJsonCode(response, 409, 'runtime_usage_request_already_recorded')
        expect(fetchMock).not.toHaveBeenCalled()
        expect(mocks.recordHostedProviderUsage).toHaveBeenCalledWith(
            expect.objectContaining({
                workspaceId: 'workspace_1',
                roomId: 'room_1',
                sessionKey: 'thread_1',
                runId: 'run_1',
                jobId: 'job_1',
                provider: 'brave',
                model: 'brave-search',
                costMicros: 10000,
                billingReservationId: 'reservation_1',
                idempotencyKey: 'provider_proxy:brave:workspace_1:room_1:usage-request-123456',
                metadata: expect.objectContaining({
                    settlementRepair: true,
                }),
            }),
        )
        expect(mocks.ensureHostedBillingAccount).not.toHaveBeenCalled()
    })

    it('rejects OpenRouter proxy job context that does not belong to the room', async () => {
        const fetchMock = vi.fn(async () => new Response('{}'))
        vi.stubGlobal('fetch', fetchMock)

        const response = await callRoute({
            path: '/api/hosted/runtime/provider/openrouter/v1/workspaces/workspace_1/rooms/room_1/chat/completions',
            headers: {
                ...openRouterRuntimeHeaders(),
                'x-agent-room-job-id': 'job_other',
            },
            body: {
                model: 'openrouter/test-model',
                messages: [],
            },
        })

        await expectJsonCode(response, 400, 'runtime_usage_context_invalid')
        expect(fetchMock).not.toHaveBeenCalled()
        expect(mocks.authorizeHostedBillingReservation).not.toHaveBeenCalled()
    })

    it('requires runtime correlation context for OpenRouter proxy billing', async () => {
        const fetchMock = vi.fn(async () => new Response('{}'))
        vi.stubGlobal('fetch', fetchMock)

        const response = await callRoute({
            path: '/api/hosted/runtime/provider/openrouter/v1/workspaces/workspace_1/rooms/room_1/chat/completions',
            headers: {
                'x-agent-room-usage-request-id': 'usage-request-123456',
            },
            body: {
                model: 'openrouter/test-model',
                messages: [],
            },
        })

        await expectJsonCode(response, 400, 'runtime_usage_context_required')
        expect(fetchMock).not.toHaveBeenCalled()
        expect(mocks.ensureHostedBillingAccount).not.toHaveBeenCalled()
    })

    it('rejects duplicate in-flight OpenRouter proxy usage ids before calling the provider', async () => {
        const fetchMock = vi.fn(async () => new Response('{}'))
        vi.stubGlobal('fetch', fetchMock)
        mocks.authorizeHostedBillingReservation.mockRejectedValue(
            new mocks.HostedBillingReservationAlreadyExistsError(),
        )

        const response = await callRoute({
            path: '/api/hosted/runtime/provider/openrouter/v1/workspaces/workspace_1/rooms/room_1/chat/completions',
            headers: openRouterRuntimeHeaders(),
            body: {
                model: 'openrouter/test-model',
                messages: [],
            },
        })

        await expectJsonCode(response, 409, 'runtime_usage_request_already_in_flight')
        expect(fetchMock).not.toHaveBeenCalled()
    })

    it('settles OpenRouter proxy usage from provider-returned cost before returning the body', async () => {
        const fetchMock = vi.fn(
            async (_input: Parameters<typeof fetch>[0], _init?: Parameters<typeof fetch>[1]) =>
                new Response(
                    JSON.stringify({
                        id: 'completion_1',
                        usage: {
                            cost: 0.123456,
                        },
                    }),
                    {
                        headers: {
                            'content-type': 'application/json',
                        },
                    },
                ),
        )
        vi.stubGlobal('fetch', fetchMock)

        const response = await callRoute({
            path: '/api/hosted/runtime/provider/openrouter/v1/workspaces/workspace_1/rooms/room_1/chat/completions',
            headers: openRouterRuntimeHeaders(),
            body: {
                model: 'openrouter/test-model',
                messages: [],
            },
        })

        expect(response.status).toBe(200)
        await expect(response.json()).resolves.toMatchObject({
            id: 'completion_1',
        })
        expect(fetchMock).toHaveBeenCalledTimes(1)
        const providerInit = fetchMock.mock.calls[0]![1] as RequestInit
        expect(JSON.parse(String(providerInit.body))).toMatchObject({
            model: 'openrouter/test-model',
            usage: {
                include: true,
            },
        })
        expect(mocks.recordHostedProviderUsage).toHaveBeenCalledWith(
            expect.objectContaining({
                workspaceId: 'workspace_1',
                roomId: 'room_1',
                sessionKey: 'thread_1',
                runId: 'run_1',
                jobId: 'job_1',
                provider: 'openrouter',
                model: 'openrouter/test-model',
                costMicros: 123456,
                estimatedCostUsd: 0.123456,
                billingReservationId: 'reservation_1',
                idempotencyKey: 'provider_proxy:openrouter:workspace_1:room_1:usage-request-123456',
            }),
        )
        expect(response.headers.get('x-agent-room-billing-reservation-id')).toBe('reservation_1')
        expect(mocks.releaseHostedBillingReservation).not.toHaveBeenCalled()
    })

    it('does not return OpenRouter provider bodies when exact provider cost is missing', async () => {
        const fetchMock = vi.fn(async () => new Response(JSON.stringify({ id: 'completion_1' })))
        vi.stubGlobal('fetch', fetchMock)

        const response = await callRoute({
            path: '/api/hosted/runtime/provider/openrouter/v1/workspaces/workspace_1/rooms/room_1/chat/completions',
            headers: openRouterRuntimeHeaders(),
            body: {
                model: 'openrouter/test-model',
                messages: [],
            },
        })

        await expectJsonCode(response, 502, 'provider_actual_cost_missing')
        expect(mocks.recordHostedProviderUsageBlocked).toHaveBeenCalledWith(
            expect.objectContaining({
                workspaceId: 'workspace_1',
                roomId: 'room_1',
                sessionKey: 'thread_1',
                runId: 'run_1',
                jobId: 'job_1',
                provider: 'openrouter',
                model: 'openrouter/test-model',
                idempotencyKey: 'provider_proxy:openrouter:workspace_1:room_1:usage-request-123456',
                metadata: expect.objectContaining({
                    missingProviderActualCost: true,
                    reservationId: 'reservation_1',
                }),
            }),
        )
        expect(mocks.recordHostedProviderUsage).not.toHaveBeenCalled()
        expect(mocks.releaseHostedBillingReservation).toHaveBeenCalledWith(
            expect.objectContaining({
                workspaceId: 'workspace_1',
                reservationId: 'reservation_1',
            }),
        )
    })

    it('releases OpenRouter preflight reservations when the provider rejects the request', async () => {
        const fetchMock = vi.fn(async () => new Response('rate limited', { status: 429 }))
        vi.stubGlobal('fetch', fetchMock)

        const response = await callRoute({
            path: '/api/hosted/runtime/provider/openrouter/v1/workspaces/workspace_1/rooms/room_1/chat/completions',
            headers: openRouterRuntimeHeaders(),
            body: {
                model: 'openrouter/test-model',
                messages: [],
            },
        })

        expect(response.status).toBe(429)
        await expect(response.text()).resolves.toBe('rate limited')
        expect(mocks.releaseHostedBillingReservation).toHaveBeenCalledWith(
            expect.objectContaining({
                workspaceId: 'workspace_1',
                reservationId: 'reservation_1',
            }),
        )
        expect(mocks.recordHostedProviderUsage).not.toHaveBeenCalled()
    })

    it('does not return OpenRouter provider bodies when settlement fails', async () => {
        const fetchMock = vi.fn(
            async () =>
                new Response(
                    JSON.stringify({
                        id: 'completion_1',
                        usage: {
                            cost: 0.01,
                        },
                    }),
                ),
        )
        vi.stubGlobal('fetch', fetchMock)
        mocks.recordHostedProviderUsage.mockRejectedValue(new Error('settlement failed'))

        const response = await callRoute({
            path: '/api/hosted/runtime/provider/openrouter/v1/workspaces/workspace_1/rooms/room_1/chat/completions',
            headers: openRouterRuntimeHeaders(),
            body: {
                model: 'openrouter/test-model',
                messages: [],
            },
        })

        await expectJsonCode(response, 502, 'provider_billing_settlement_failed')
        expect(mocks.releaseHostedBillingReservation).toHaveBeenCalledWith(
            expect.objectContaining({
                workspaceId: 'workspace_1',
                reservationId: 'reservation_1',
            }),
        )
    })

    it('settles managed Brave proxy usage before returning the body', async () => {
        const fetchMock = vi.fn(
            async (_input: Parameters<typeof fetch>[0], _init?: Parameters<typeof fetch>[1]) =>
                new Response(
                    JSON.stringify({
                        web: {
                            results: [],
                        },
                    }),
                    {
                        headers: {
                            'content-type': 'application/json',
                        },
                    },
                ),
        )
        vi.stubGlobal('fetch', fetchMock)
        mocks.getHostedRuntimeEndpointState.mockResolvedValue(
            runtimeEndpoint({
                providerCandidate: 'user_key',
            }),
        )

        const response = await callRoute({
            method: 'GET',
            path: '/api/hosted/runtime/provider/brave/v1/workspaces/workspace_1/rooms/room_1/res/v1/web/search?q=agent&count=5',
            headers: braveRuntimeHeaders(),
            token: null,
        })

        expect(response.status).toBe(200)
        await expect(response.json()).resolves.toMatchObject({
            web: {
                results: [],
            },
        })
        expect(fetchMock).toHaveBeenCalledTimes(1)
        const providerUrl = fetchMock.mock.calls[0]![0] as URL
        expect(providerUrl.toString()).toBe(
            'https://api.search.brave.com/res/v1/web/search?q=agent&count=5',
        )
        const providerInit = fetchMock.mock.calls[0]![1] as RequestInit
        const providerHeaders = new Headers(providerInit.headers)
        expect(providerHeaders.get('x-subscription-token')).toBe('brave-platform-key')
        expect(providerHeaders.get('authorization')).toBeNull()
        expect(mocks.authorizeHostedBillingReservation).toHaveBeenCalledWith(
            expect.objectContaining({
                workspaceId: 'workspace_1',
                roomId: 'room_1',
                sessionKey: 'thread_1',
                runId: 'run_1',
                jobId: 'job_1',
                provider: 'brave',
                amountCents: 2,
                idempotencyKey: 'brave:workspace_1:room_1:usage-request-123456',
            }),
        )
        expect(mocks.recordHostedProviderUsage).toHaveBeenCalledWith(
            expect.objectContaining({
                workspaceId: 'workspace_1',
                roomId: 'room_1',
                sessionKey: 'thread_1',
                runId: 'run_1',
                jobId: 'job_1',
                provider: 'brave',
                model: 'brave-search',
                costMicros: 10000,
                estimatedCostUsd: 0.01,
                billingReservationId: 'reservation_1',
                idempotencyKey: 'provider_proxy:brave:workspace_1:room_1:usage-request-123456',
            }),
        )
        expect(response.headers.get('x-agent-room-billing-reservation-id')).toBe('reservation_1')
    })

    it('does not return Brave provider bodies when settlement fails', async () => {
        const fetchMock = vi.fn(
            async () =>
                new Response(
                    JSON.stringify({
                        web: {
                            results: [],
                        },
                    }),
                    {
                        headers: {
                            'content-type': 'application/json',
                        },
                    },
                ),
        )
        vi.stubGlobal('fetch', fetchMock)
        mocks.recordHostedProviderUsage.mockRejectedValue(new Error('settlement failed'))

        const response = await callRoute({
            method: 'GET',
            path: '/api/hosted/runtime/provider/brave/v1/workspaces/workspace_1/rooms/room_1/res/v1/web/search?q=agent',
            headers: braveRuntimeHeaders(),
            token: null,
        })

        await expectJsonCode(response, 502, 'provider_billing_settlement_failed')
        expect(mocks.releaseHostedBillingReservation).toHaveBeenCalledWith(
            expect.objectContaining({
                workspaceId: 'workspace_1',
                reservationId: 'reservation_1',
            }),
        )
    })

    it('requires the runtime token in the Brave subscription header', async () => {
        const fetchMock = vi.fn(async () => new Response('{}'))
        vi.stubGlobal('fetch', fetchMock)

        const response = await callRoute({
            method: 'GET',
            path: '/api/hosted/runtime/provider/brave/v1/workspaces/workspace_1/rooms/room_1/res/v1/web/search?q=agent',
            headers: braveRuntimeHeaders({
                'x-subscription-token': 'wrong-runtime-token-123456',
            }),
            token: null,
        })

        await expectJsonCode(response, 403, 'runtime_token_invalid')
        expect(fetchMock).not.toHaveBeenCalled()
        expect(mocks.ensureHostedBillingAccount).not.toHaveBeenCalled()
    })

    it('blocks managed Brave proxy calls before the provider when balance is exhausted', async () => {
        const fetchMock = vi.fn(async () => new Response('{}'))
        vi.stubGlobal('fetch', fetchMock)
        mocks.authorizeHostedBillingReservation.mockRejectedValue(
            new HostedBillingBalanceExhaustedError(),
        )

        const response = await callRoute({
            method: 'GET',
            path: '/api/hosted/runtime/provider/brave/v1/workspaces/workspace_1/rooms/room_1/res/v1/web/search?q=agent',
            headers: braveRuntimeHeaders(),
            token: null,
        })

        await expectJsonCode(response, 402, 'hosted_billing_balance_exhausted')
        expect(fetchMock).not.toHaveBeenCalled()
        expect(mocks.recordHostedProviderUsage).not.toHaveBeenCalled()
    })

    it('fails managed Brave proxy reservations closed without misclassifying infrastructure errors as exhausted balance', async () => {
        const fetchMock = vi.fn(async () => new Response('{}'))
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
        vi.stubGlobal('fetch', fetchMock)
        mocks.authorizeHostedBillingReservation.mockRejectedValue(new Error('D1 unavailable'))

        try {
            const response = await callRoute({
                method: 'GET',
                path: '/api/hosted/runtime/provider/brave/v1/workspaces/workspace_1/rooms/room_1/res/v1/web/search?q=agent',
                headers: braveRuntimeHeaders(),
                token: null,
            })

            await expectJsonCode(response, 502, 'provider_billing_reservation_failed')
            expect(fetchMock).not.toHaveBeenCalled()
            expect(mocks.recordHostedProviderUsage).not.toHaveBeenCalled()
            expect(errorSpy).toHaveBeenCalledWith(
                'Hosted provider preflight reservation failed',
                expect.objectContaining({
                    workspaceId: 'workspace_1',
                    roomId: 'room_1',
                    provider: 'brave',
                    usageRequestId: 'usage-request-123456',
                }),
            )
        } finally {
            errorSpy.mockRestore()
        }
    })

    it('releases managed Brave reservations when the provider rejects the request', async () => {
        const fetchMock = vi.fn(async () => new Response('rate limited', { status: 429 }))
        vi.stubGlobal('fetch', fetchMock)

        const response = await callRoute({
            method: 'GET',
            path: '/api/hosted/runtime/provider/brave/v1/workspaces/workspace_1/rooms/room_1/res/v1/web/search?q=agent',
            headers: braveRuntimeHeaders(),
            token: null,
        })

        expect(response.status).toBe(429)
        await expect(response.text()).resolves.toBe('rate limited')
        expect(mocks.releaseHostedBillingReservation).toHaveBeenCalledWith(
            expect.objectContaining({
                workspaceId: 'workspace_1',
                reservationId: 'reservation_1',
            }),
        )
        expect(mocks.recordHostedProviderUsage).not.toHaveBeenCalled()
    })

    it('settles managed Browserbase session usage before returning the provider body', async () => {
        const fetchMock = vi.fn(
            async (_input: Parameters<typeof fetch>[0], _init?: Parameters<typeof fetch>[1]) =>
                new Response(
                    JSON.stringify({
                        id: 'bb-session-1',
                        connectUrl: 'wss://connect.browserbase.com/session',
                    }),
                    {
                        headers: {
                            'content-type': 'application/json',
                        },
                    },
                ),
        )
        vi.stubGlobal('fetch', fetchMock)

        const response = await callRoute({
            path: '/api/hosted/runtime/provider/browserbase/v1/workspaces/workspace_1/rooms/room_1/sessions',
            headers: browserbaseRuntimeHeaders(),
            token: null,
            body: {
                keepAlive: true,
                browserSettings: {
                    timeout: 120,
                },
            },
        })

        expect(response.status).toBe(200)
        await expect(response.json()).resolves.toMatchObject({
            id: 'bb-session-1',
        })
        const providerUrl = fetchMock.mock.calls[0]![0] as URL
        expect(providerUrl.toString()).toBe('https://api.browserbase.com/v1/sessions')
        const providerHeaders = new Headers((fetchMock.mock.calls[0]![1] as RequestInit).headers)
        expect(providerHeaders.get('x-bb-api-key')).toBe('browserbase-platform-key')
        expect(JSON.parse(String((fetchMock.mock.calls[0]![1] as RequestInit).body))).toEqual({
            keepAlive: true,
            browserSettings: {
                timeout: 120,
            },
        })
        expect(mocks.recordHostedBrowserbaseSession).toHaveBeenCalledWith(
            expect.objectContaining({
                workspaceId: 'workspace_1',
                roomId: 'room_1',
                browserbaseSessionId: 'bb-session-1',
                usageRequestId: 'usage-request-123456',
                usageContext: expect.objectContaining({
                    sessionKey: 'thread_1',
                    runId: 'run_1',
                    jobId: 'job_1',
                }),
            }),
        )
        expect(mocks.authorizeHostedBillingReservation).toHaveBeenCalledWith(
            expect.objectContaining({
                provider: 'browserbase',
                amountCents: 7,
                idempotencyKey: 'browserbase:workspace_1:room_1:usage-request-123456',
            }),
        )
        expect(mocks.recordHostedProviderUsage).toHaveBeenCalledWith(
            expect.objectContaining({
                provider: 'browserbase',
                model: 'browserbase-session',
                costMicros: 50000,
                idempotencyKey:
                    'provider_proxy:browserbase:workspace_1:room_1:usage-request-123456',
            }),
        )
    })

    it('blocks duplicate Browserbase session creation after a prior session record for the usage request', async () => {
        const fetchMock = vi.fn(async () => new Response('{}'))
        vi.stubGlobal('fetch', fetchMock)
        mocks.readHostedBrowserbaseSessionByUsageRequestId.mockResolvedValue({
            browserbaseSessionId: 'bb-session-existing',
            workspaceId: 'workspace_1',
            roomId: 'room_1',
            sessionKey: 'thread_1',
            runId: 'run_1',
            jobId: 'job_1',
            usageRequestId: 'usage-request-123456',
            status: 'active',
            createdAt: new Date(0).toISOString(),
            updatedAt: new Date(0).toISOString(),
            releasedAt: null,
        })

        const response = await callRoute({
            path: '/api/hosted/runtime/provider/browserbase/v1/workspaces/workspace_1/rooms/room_1/sessions',
            headers: browserbaseRuntimeHeaders(),
            token: null,
            body: {
                keepAlive: true,
                browserSettings: {
                    timeout: 120,
                },
            },
        })

        await expectJsonCode(response, 409, 'runtime_usage_request_already_in_flight')
        expect(fetchMock).not.toHaveBeenCalled()
        expect(mocks.authorizeHostedBillingReservation).not.toHaveBeenCalled()
        expect(mocks.recordHostedBrowserbaseSession).not.toHaveBeenCalled()
        expect(mocks.recordHostedProviderUsage).not.toHaveBeenCalled()
    })

    it('releases untracked Browserbase sessions when ownership recording fails', async () => {
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
        const fetchMock = vi
            .fn()
            .mockResolvedValueOnce(
                new Response(
                    JSON.stringify({
                        id: 'bb-session-untracked',
                        connectUrl: 'wss://connect.browserbase.com/session',
                    }),
                    {
                        headers: {
                            'content-type': 'application/json',
                        },
                    },
                ),
            )
            .mockResolvedValueOnce(new Response('{}'))
        vi.stubGlobal('fetch', fetchMock)
        mocks.recordHostedBrowserbaseSession.mockRejectedValue(new Error('D1 unavailable'))

        try {
            const response = await callRoute({
                path: '/api/hosted/runtime/provider/browserbase/v1/workspaces/workspace_1/rooms/room_1/sessions',
                headers: browserbaseRuntimeHeaders(),
                token: null,
                body: {
                    keepAlive: true,
                    browserSettings: {
                        timeout: 120,
                    },
                },
            })

            await expectJsonCode(response, 502, 'managed_browserbase_session_record_failed')
            expect(mocks.releaseHostedBillingReservation).toHaveBeenCalledWith(
                expect.objectContaining({
                    workspaceId: 'workspace_1',
                    reservationId: 'reservation_1',
                }),
            )
            expect(fetchMock).toHaveBeenCalledTimes(2)
            const [releaseUrl, releaseInit] = fetchMock.mock.calls[1] as unknown as [
                URL,
                RequestInit,
            ]
            expect(releaseUrl.toString()).toBe(
                'https://api.browserbase.com/v1/sessions/bb-session-untracked',
            )
            expect(JSON.parse(String(releaseInit.body))).toEqual({
                status: 'REQUEST_RELEASE',
            })
            expect(mocks.recordHostedProviderUsage).not.toHaveBeenCalled()
        } finally {
            errorSpy.mockRestore()
        }
    })

    it('rejects unexpected Browserbase session fields before using the platform key', async () => {
        const fetchMock = vi.fn(async () => new Response('{}'))
        vi.stubGlobal('fetch', fetchMock)

        const response = await callRoute({
            path: '/api/hosted/runtime/provider/browserbase/v1/workspaces/workspace_1/rooms/room_1/sessions',
            headers: browserbaseRuntimeHeaders(),
            token: null,
            body: {
                keepAlive: true,
                browserSettings: {
                    timeout: 120,
                },
                projectId: 'tenant-selected-project',
            },
        })

        await expectJsonCode(response, 400, 'invalid_managed_browserbase_request')
        expect(fetchMock).not.toHaveBeenCalled()
        expect(mocks.authorizeHostedBillingReservation).not.toHaveBeenCalled()
        expect(mocks.recordHostedBrowserbaseSession).not.toHaveBeenCalled()
    })

    it('rejects Browserbase query options before using the platform key', async () => {
        const fetchMock = vi.fn(async () => new Response('{}'))
        vi.stubGlobal('fetch', fetchMock)

        const response = await callRoute({
            path: '/api/hosted/runtime/provider/browserbase/v1/workspaces/workspace_1/rooms/room_1/sessions?projectId=tenant-selected-project',
            headers: browserbaseRuntimeHeaders(),
            token: null,
            body: {
                keepAlive: true,
                browserSettings: {
                    timeout: 120,
                },
            },
        })

        await expectJsonCode(response, 400, 'invalid_managed_browserbase_request')
        expect(fetchMock).not.toHaveBeenCalled()
        expect(mocks.authorizeHostedBillingReservation).not.toHaveBeenCalled()
        expect(mocks.recordHostedBrowserbaseSession).not.toHaveBeenCalled()
    })

    it('blocks Browserbase debug for session ids not owned by the requesting room', async () => {
        const fetchMock = vi.fn(async () => new Response('{}'))
        vi.stubGlobal('fetch', fetchMock)
        mocks.readHostedBrowserbaseSession.mockResolvedValue(null)

        const response = await callRoute({
            method: 'GET',
            path: '/api/hosted/runtime/provider/browserbase/v1/workspaces/workspace_1/rooms/room_1/sessions/bb-session-foreign/debug',
            headers: browserbaseRuntimeHeaders(),
            token: null,
        })

        await expectJsonCode(response, 404, 'managed_browserbase_session_not_found')
        expect(mocks.readHostedBrowserbaseSession).toHaveBeenCalledWith(
            expect.objectContaining({
                workspaceId: 'workspace_1',
                roomId: 'room_1',
                browserbaseSessionId: 'bb-session-foreign',
            }),
        )
        expect(fetchMock).not.toHaveBeenCalled()
        expect(mocks.authorizeHostedBillingReservation).not.toHaveBeenCalled()
    })

    it('allows Browserbase debug only for active sessions owned by the requesting room', async () => {
        const fetchMock = vi.fn(
            async () =>
                new Response(
                    JSON.stringify({
                        debuggerUrl: 'https://browserbase.example.test/debug',
                        pages: [],
                    }),
                    {
                        headers: {
                            'content-type': 'application/json',
                        },
                    },
                ),
        )
        vi.stubGlobal('fetch', fetchMock)

        const response = await callRoute({
            method: 'GET',
            path: '/api/hosted/runtime/provider/browserbase/v1/workspaces/workspace_1/rooms/room_1/sessions/bb-session-1/debug',
            headers: browserbaseRuntimeHeaders(),
            token: null,
        })

        expect(response.status).toBe(200)
        const [providerUrl] = fetchMock.mock.calls[0] as unknown as [URL, RequestInit]
        expect(providerUrl.toString()).toBe(
            'https://api.browserbase.com/v1/sessions/bb-session-1/debug',
        )
        expect(mocks.authorizeHostedBillingReservation).not.toHaveBeenCalled()
        expect(mocks.recordHostedProviderUsage).not.toHaveBeenCalled()
    })

    it('marks owned Browserbase sessions as release requested before forwarding release', async () => {
        const fetchMock = vi.fn(async () => new Response('{}'))
        vi.stubGlobal('fetch', fetchMock)

        const response = await callRoute({
            path: '/api/hosted/runtime/provider/browserbase/v1/workspaces/workspace_1/rooms/room_1/sessions/bb-session-1',
            headers: browserbaseRuntimeHeaders(),
            token: null,
            body: {
                status: 'REQUEST_RELEASE',
            },
        })

        expect(response.status).toBe(200)
        expect(mocks.requestHostedBrowserbaseSessionRelease).toHaveBeenCalledWith(
            expect.objectContaining({
                workspaceId: 'workspace_1',
                roomId: 'room_1',
                browserbaseSessionId: 'bb-session-1',
            }),
        )
        expect(mocks.markHostedBrowserbaseSessionReleased).toHaveBeenCalledWith(
            expect.objectContaining({
                workspaceId: 'workspace_1',
                roomId: 'room_1',
                browserbaseSessionId: 'bb-session-1',
            }),
        )
        const [, providerInit] = fetchMock.mock.calls[0] as unknown as [URL, RequestInit]
        expect(JSON.parse(String(providerInit.body))).toEqual({
            status: 'REQUEST_RELEASE',
        })
        expect(mocks.authorizeHostedBillingReservation).not.toHaveBeenCalled()
    })

    it('blocks managed Browserbase for non-Pro billing plans before using the platform key', async () => {
        const fetchMock = vi.fn(async () => new Response('{}'))
        vi.stubGlobal('fetch', fetchMock)
        mocks.ensureHostedBillingAccount.mockResolvedValue({
            workspaceId: 'workspace_1',
            planKey: 'standard',
            planStatus: 'active',
            availableBalanceCents: 100,
        })

        const response = await callRoute({
            path: '/api/hosted/runtime/provider/browserbase/v1/workspaces/workspace_1/rooms/room_1/sessions',
            headers: browserbaseRuntimeHeaders(),
            token: null,
            body: {
                keepAlive: true,
                browserSettings: {
                    timeout: 120,
                },
            },
        })

        await expectJsonCode(response, 403, 'managed_browserbase_requires_pro')
        expect(fetchMock).not.toHaveBeenCalled()
        expect(mocks.authorizeHostedBillingReservation).not.toHaveBeenCalled()
    })

    it('settles managed fetch usage through the worker proxy', async () => {
        const fetchMock = vi.fn(
            async (input: Parameters<typeof fetch>[0], _init?: Parameters<typeof fetch>[1]) => {
                const url = String(input)
                if (url.startsWith('https://cloudflare-dns.com/dns-query')) {
                    return new Response(
                        JSON.stringify({
                            Answer: [
                                {
                                    type: url.includes('type=AAAA') ? 28 : 1,
                                    data: url.includes('type=AAAA')
                                        ? '2606:2800:220:1:248:1893:25c8:1946'
                                        : '93.184.216.34',
                                },
                            ],
                        }),
                        {
                            headers: {
                                'content-type': 'application/json',
                            },
                        },
                    )
                }
                return new Response('<title>Example</title><main>Hello</main>', {
                    headers: {
                        'content-type': 'text/html',
                    },
                })
            },
        )
        vi.stubGlobal('fetch', fetchMock)

        const response = await callRoute({
            path: '/api/hosted/runtime/fetch/workspaces/workspace_1/rooms/room_1',
            headers: openRouterRuntimeHeaders(),
            body: {
                url: 'https://example.com/page',
                timeoutMs: 5000,
            },
        })

        expect(response.status).toBe(200)
        await expect(response.json()).resolves.toMatchObject({
            finalUrl: 'https://example.com/page',
            title: 'Example',
            text: 'Example Hello',
        })
        expect(mocks.authorizeHostedBillingReservation).toHaveBeenCalledWith(
            expect.objectContaining({
                provider: 'fetch_url',
                amountCents: 2,
                idempotencyKey: 'fetch_url:workspace_1:room_1:usage-request-123456',
            }),
        )
        expect(mocks.recordHostedProviderUsage).toHaveBeenCalledWith(
            expect.objectContaining({
                provider: 'fetch_url',
                model: 'fetch_url',
                costMicros: 10000,
                idempotencyKey: 'provider_proxy:fetch_url:workspace_1:room_1:usage-request-123456',
            }),
        )
    })

    it('rejects malformed state callbacks before writing runtime state', async () => {
        const response = await callRoute({
            path: '/api/hosted/runtime/state',
            body: {
                workspaceId: 'workspace_1',
                roomId: 'room_1',
                state: {
                    relativePath: 'state.json',
                    operation: 'replace',
                    contentBase64: 'e30',
                },
            },
        })

        await expectJsonCode(response, 400, 'invalid_state_callback')
        expect(mocks.putHostedRuntimeStateFile).not.toHaveBeenCalled()
        expect(mocks.deleteHostedRuntimeStateFile).not.toHaveBeenCalled()
    })
})
