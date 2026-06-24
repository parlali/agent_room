import { afterEach, describe, expect, it, vi } from 'vitest'
import {
    authorizeHostedBillingReservation,
    creditHostedBalance,
    ensureHostedBillingAccount,
    expireIncludedBalance,
    readHostedProviderUsageSettlementByIdempotencyKey,
} from './hosted-billing-repository'
import { createHostedStripeCheckout, readHostedBillingSummary } from './hosted-stripe'
import { recordHostedProviderUsage, recordHostedRuntimeUsageEvent } from './hosted-usage-billing'
import { FakeD1, hostedEnv, stripeHostedEnv } from './hosted-billing-test-support'

afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
})

describe('hosted billing usage markup', () => {
    it('debits the marked-up cents and keeps the raw provider cost on the usage event', async () => {
        const db = new FakeD1()
        const env = hostedEnv(db)
        await ensureHostedBillingAccount({
            env,
            workspaceId: 'workspace_1',
            now: new Date(0),
        })
        await creditHostedBalance({
            env,
            workspaceId: 'workspace_1',
            source: 'subscription_included_credit',
            amountCents: 100,
            idempotencyKey: 'included',
            now: new Date(1),
        })

        const result = await recordHostedProviderUsage({
            env,
            workspaceId: 'workspace_1',
            roomId: 'room_1',
            sessionKey: null,
            runId: null,
            jobId: null,
            provider: 'openrouter',
            model: 'openrouter/auto',
            inputTokens: null,
            outputTokens: null,
            cachedTokens: null,
            costMicros: 100000,
            now: new Date(2),
        })
        expect(result.debitedCents).toBe(13)
        const usage = Array.from(db.usage.values())[0]
        expect(usage.costMicros).toBe(100000)
        const ledger = db.ledger.get(result.ledgerEntryId!)!
        expect(ledger.source).toBe('hosted_openrouter_usage')
        expect(ledger.metadata).toContain('"markupBps":13000')
        expect(ledger.metadata).toContain('"billedMicros":130000')
        const account = db.accounts.get('workspace_1')!
        expect(account.includedBalanceCents).toBe(87)
        expect(account.purchasedBalanceCents).toBe(0)
    })

    it('releases active reservations for exact zero-cost provider usage', async () => {
        const db = new FakeD1()
        const env = hostedEnv(db)
        await ensureHostedBillingAccount({
            env,
            workspaceId: 'workspace_1',
            now: new Date(0),
        })
        await creditHostedBalance({
            env,
            workspaceId: 'workspace_1',
            source: 'subscription_included_credit',
            amountCents: 10,
            idempotencyKey: 'included',
            now: new Date(1),
        })
        const reservation = await authorizeHostedBillingReservation({
            env,
            workspaceId: 'workspace_1',
            roomId: 'room_1',
            provider: 'openrouter',
            amountCents: 1,
            idempotencyKey: 'zero_cost_reservation',
            expiresAt: new Date(10_000),
            now: new Date(2),
        })

        const result = await recordHostedProviderUsage({
            env,
            workspaceId: 'workspace_1',
            roomId: 'room_1',
            sessionKey: 'thread_1',
            runId: 'run_1',
            jobId: null,
            provider: 'openrouter',
            model: 'openrouter/free',
            inputTokens: null,
            outputTokens: null,
            cachedTokens: null,
            costMicros: 0,
            billingReservationId: reservation.id,
            releaseReservationOnDebitFailure: false,
            idempotencyKey: 'zero_cost_usage',
            now: new Date(3),
        })

        expect(result.debitedCents).toBe(0)
        expect(result.ledgerEntryId).toBeNull()
        expect(db.reservations.get(reservation.id)?.status).toBe('released')
        expect(db.accounts.get('workspace_1')?.includedReservedCents).toBe(0)
        expect(db.usage.get(result.usageEventId)?.billingStatus).toBe('not_billable')
        await expect(
            readHostedProviderUsageSettlementByIdempotencyKey({
                env,
                workspaceId: 'workspace_1',
                idempotencyKey: 'zero_cost_usage',
            }),
        ).resolves.toMatchObject({
            id: result.usageEventId,
            provider: 'openrouter',
            costMicros: 0,
        })
    })

    it('does not debit managed runtime OpenRouter callbacks from estimated session pricing', async () => {
        const db = new FakeD1()
        const env = hostedEnv(db)
        await ensureHostedBillingAccount({
            env,
            workspaceId: 'workspace_1',
            now: new Date(0),
        })
        await creditHostedBalance({
            env,
            workspaceId: 'workspace_1',
            source: 'subscription_included_credit',
            amountCents: 100,
            idempotencyKey: 'included',
            now: new Date(1),
        })
        const input = {
            env,
            workspaceId: 'workspace_1',
            providerCandidate: 'hosted_openrouter' as const,
            idempotencyKey: 'runtime:workspace_1:room_1:1:7:provider.finished',
            event: {
                roomId: 'room_1',
                sessionKey: 'thread_1',
                runId: 'run_1',
                jobId: null,
                kind: 'provider' as const,
                provider: 'openrouter',
                model: 'openrouter/auto',
                toolName: null,
                inputTokens: 10,
                outputTokens: 20,
                cachedTokens: 0,
                reasoningTokens: 3,
                totalTokens: 33,
                durationMs: 1000,
                activeDurationMs: 900,
                idleDurationMs: 100,
                estimatedCostUsd: 0.1,
                metadata: {},
            },
            now: new Date(2),
        }
        const first = await recordHostedRuntimeUsageEvent(input)
        const second = await recordHostedRuntimeUsageEvent(input)

        expect(first.usageEventId).toBe(second.usageEventId)
        expect(first.debitedCents).toBe(0)
        expect(second.debitedCents).toBe(0)
        expect(db.usage.size).toBe(1)
        expect(db.ledger.size).toBe(1)
        expect(Array.from(db.ledger.values()).map((entry) => entry.source)).toEqual([
            'subscription_included_credit',
        ])
        expect(Array.from(db.usage.values())[0]?.billingStatus).toBe('not_billable')
        expect(Array.from(db.usage.values())[0]?.costMicros).toBeNull()
        expect(JSON.parse(Array.from(db.usage.values())[0]?.metadata ?? '{}')).toMatchObject({
            providerProxyBillingAuthority: 'worker_proxy',
            runtimeCallbackBilling: 'telemetry_only',
        })
        expect(db.accounts.get('workspace_1')?.includedBalanceCents).toBe(100)
        expect(db.accounts.get('workspace_1')?.includedReservedCents).toBe(0)
    })

    it('records managed OpenRouter runtime callbacks as telemetry without provider cost billing', async () => {
        const db = new FakeD1()
        const env = hostedEnv(db)
        await ensureHostedBillingAccount({
            env,
            workspaceId: 'workspace_1',
            now: new Date(0),
        })
        await creditHostedBalance({
            env,
            workspaceId: 'workspace_1',
            source: 'subscription_included_credit',
            amountCents: 100,
            idempotencyKey: 'included',
            now: new Date(1),
        })

        const result = await recordHostedRuntimeUsageEvent({
            env,
            workspaceId: 'workspace_1',
            providerCandidate: 'hosted_openrouter',
            idempotencyKey: 'runtime:workspace_1:room_1:1:10:provider.finished',
            event: {
                roomId: 'room_1',
                sessionKey: 'thread_1',
                runId: 'run_1',
                jobId: null,
                kind: 'provider',
                provider: 'openrouter',
                model: 'openrouter/auto',
                toolName: null,
                inputTokens: 10,
                outputTokens: 20,
                cachedTokens: 0,
                reasoningTokens: null,
                totalTokens: 30,
                durationMs: 1000,
                activeDurationMs: null,
                idleDurationMs: null,
                estimatedCostUsd: 0.1,
                metadata: {},
            },
            now: new Date(2),
        })

        expect(result.debitedCents).toBe(0)
        expect(result.ledgerEntryId).toBeNull()
        expect(db.ledger.size).toBe(1)
        const usage = Array.from(db.usage.values())[0]!
        expect(usage.billingStatus).toBe('not_billable')
        expect(usage.costMicros).toBeNull()
        expect(JSON.parse(usage.metadata ?? '{}')).toMatchObject({
            providerProxyBillingAuthority: 'worker_proxy',
            runtimeCallbackBilling: 'telemetry_only',
        })
        expect(db.accounts.get('workspace_1')?.includedBalanceCents).toBe(100)
    })

    it('ignores managed OpenRouter callback cost metadata for billing', async () => {
        const db = new FakeD1()
        const env = hostedEnv(db)
        await ensureHostedBillingAccount({
            env,
            workspaceId: 'workspace_1',
            now: new Date(0),
        })
        await creditHostedBalance({
            env,
            workspaceId: 'workspace_1',
            source: 'subscription_included_credit',
            amountCents: 100,
            idempotencyKey: 'included',
            now: new Date(1),
        })

        const result = await recordHostedRuntimeUsageEvent({
            env,
            workspaceId: 'workspace_1',
            providerCandidate: 'hosted_openrouter',
            idempotencyKey: 'runtime:workspace_1:room_1:1:8:provider.finished',
            event: {
                roomId: 'room_1',
                sessionKey: 'thread_1',
                runId: 'run_1',
                jobId: null,
                kind: 'provider',
                provider: 'openrouter',
                model: 'openrouter/auto',
                toolName: null,
                inputTokens: 10,
                outputTokens: 20,
                cachedTokens: 0,
                reasoningTokens: 3,
                totalTokens: 33,
                durationMs: 1000,
                activeDurationMs: 900,
                idleDurationMs: 100,
                estimatedCostUsd: 0.1,
                metadata: {
                    hostedProviderReservationIds: ['reservation_from_callback'],
                    hostedProviderUsageCharges: [
                        {
                            provider: 'openrouter',
                            reservationId: 'reservation_from_callback',
                            costMicros: 100000,
                        },
                    ],
                },
            },
            now: new Date(3),
        })

        expect(result.debitedCents).toBe(0)
        expect(result.ledgerEntryId).toBeNull()
        expect(db.accounts.get('workspace_1')?.includedBalanceCents).toBe(100)
        expect(db.accounts.get('workspace_1')?.includedReservedCents).toBe(0)
        expect(Array.from(db.usage.values())[0]?.billingStatus).toBe('not_billable')
        expect(Array.from(db.usage.values())[0]?.costMicros).toBeNull()
        expect(Array.from(db.ledger.values()).map((entry) => entry.source)).toEqual([
            'subscription_included_credit',
        ])
    })

    it('settles active reservations when retrying after the usage debit ledger already exists', async () => {
        const db = new FakeD1()
        const env = hostedEnv(db)
        await ensureHostedBillingAccount({
            env,
            workspaceId: 'workspace_1',
            now: new Date(0),
        })
        await creditHostedBalance({
            env,
            workspaceId: 'workspace_1',
            source: 'subscription_included_credit',
            amountCents: 100,
            idempotencyKey: 'included',
            now: new Date(1),
        })
        const reservation = await authorizeHostedBillingReservation({
            env,
            workspaceId: 'workspace_1',
            roomId: 'room_1',
            provider: 'openrouter',
            amountCents: 1,
            idempotencyKey: 'openrouter_retry_reservation',
            expiresAt: new Date(10),
            now: new Date(2),
        })
        const usageEventId = 'usage_retry'
        const idempotencyKey = 'provider_proxy:openrouter:workspace_1:room_1:usage_retry'
        const account = db.accounts.get('workspace_1')!
        account.includedBalanceCents = 87
        db.usage.set(usageEventId, {
            id: usageEventId,
            workspaceId: 'workspace_1',
            roomId: 'room_1',
            kind: 'provider',
            provider: 'openrouter',
            model: 'openrouter/auto',
            costMicros: 100000,
            billingStatus: 'debited',
            billingLedgerEntryId: 'ledger_retry',
            idempotencyKey,
            metadata: '{}',
            createdAt: new Date(3).toISOString(),
        })
        db.ledger.set('ledger_retry', {
            id: 'ledger_retry',
            workspaceId: 'workspace_1',
            direction: 'debit',
            source: 'hosted_openrouter_usage',
            amountCents: 13,
            balanceAfterCents: 87,
            stripeEventId: null,
            stripeCheckoutSessionId: null,
            stripeInvoiceId: null,
            usageEventId,
            idempotencyKey: `hosted_usage:${usageEventId}`,
            metadata: '{}',
            createdAt: new Date(3).toISOString(),
        })

        const result = await recordHostedProviderUsage({
            env,
            workspaceId: 'workspace_1',
            roomId: 'room_1',
            sessionKey: null,
            runId: null,
            jobId: null,
            provider: 'openrouter',
            model: 'openrouter/auto',
            inputTokens: null,
            outputTokens: null,
            cachedTokens: null,
            estimatedCostUsd: 0.1,
            costMicros: 100000,
            billingReservationId: reservation.id,
            idempotencyKey,
            metadata: {
                billedBy: 'hosted_openrouter_proxy',
                reservationId: reservation.id,
            },
            now: new Date(4),
        })

        expect(result.usageEventId).toBe(usageEventId)
        expect(result.debitedCents).toBe(13)
        expect(result.ledgerEntryId).toBe('ledger_retry')
        expect(db.reservations.get(reservation.id)?.status).toBe('settled')
        expect(db.reservations.get(reservation.id)?.billingLedgerEntryId).toBe('ledger_retry')
        expect(db.accounts.get('workspace_1')?.includedBalanceCents).toBe(87)
        expect(db.accounts.get('workspace_1')?.includedReservedCents).toBe(0)
    })

    it('does not close reservations from managed OpenRouter callback metadata', async () => {
        const db = new FakeD1()
        const env = hostedEnv(db)
        await ensureHostedBillingAccount({
            env,
            workspaceId: 'workspace_1',
            now: new Date(0),
        })
        await creditHostedBalance({
            env,
            workspaceId: 'workspace_1',
            source: 'subscription_included_credit',
            amountCents: 100,
            idempotencyKey: 'included',
            now: new Date(1),
        })
        const firstReservation = await authorizeHostedBillingReservation({
            env,
            workspaceId: 'workspace_1',
            roomId: 'room_1',
            provider: 'openrouter',
            amountCents: 1,
            idempotencyKey: 'openrouter_reservation_1',
            expiresAt: new Date(10),
            now: new Date(2),
        })
        const secondReservation = await authorizeHostedBillingReservation({
            env,
            workspaceId: 'workspace_1',
            roomId: 'room_1',
            provider: 'openrouter',
            amountCents: 1,
            idempotencyKey: 'openrouter_reservation_2',
            expiresAt: new Date(10),
            now: new Date(2),
        })

        const result = await recordHostedRuntimeUsageEvent({
            env,
            workspaceId: 'workspace_1',
            providerCandidate: 'hosted_openrouter',
            idempotencyKey: 'runtime:workspace_1:room_1:1:9:run.finished',
            event: {
                roomId: 'room_1',
                sessionKey: 'thread_1',
                runId: 'run_1',
                jobId: null,
                kind: 'run',
                provider: 'openrouter',
                model: 'openrouter/auto',
                toolName: null,
                inputTokens: 10,
                outputTokens: 20,
                cachedTokens: 0,
                reasoningTokens: 3,
                totalTokens: 33,
                durationMs: 1000,
                activeDurationMs: 900,
                idleDurationMs: 100,
                estimatedCostUsd: 0.1,
                metadata: {
                    hostedProviderReservationIds: [firstReservation.id, secondReservation.id],
                    hostedProviderUsageCharges: [
                        {
                            provider: 'openrouter',
                            reservationId: firstReservation.id,
                            costMicros: 100000,
                        },
                    ],
                },
            },
            now: new Date(3),
        })

        expect(result.debitedCents).toBe(0)
        expect(result.ledgerEntryId).toBeNull()
        expect(db.ledger.size).toBe(1)
        expect(Array.from(db.usage.values())[0]?.billingStatus).toBe('not_billable')
        expect(Array.from(db.usage.values())[0]?.costMicros).toBeNull()
        expect(db.reservations.get(firstReservation.id)?.status).toBe('authorized')
        expect(db.reservations.get(secondReservation.id)?.status).toBe('authorized')
        expect(db.accounts.get('workspace_1')?.includedBalanceCents).toBe(100)
        expect(db.accounts.get('workspace_1')?.includedReservedCents).toBe(2)
        expect(JSON.parse(Array.from(db.usage.values())[0]?.metadata ?? '{}')).toMatchObject({
            providerProxyBillingAuthority: 'worker_proxy',
            runtimeCallbackBilling: 'telemetry_only',
        })
    })

    it('does not debit Brave runtime usage without provider-returned actual dollar cost', async () => {
        const db = new FakeD1()
        const env = hostedEnv(db)
        await ensureHostedBillingAccount({
            env,
            workspaceId: 'workspace_1',
            now: new Date(0),
        })
        await creditHostedBalance({
            env,
            workspaceId: 'workspace_1',
            source: 'subscription_included_credit',
            amountCents: 100,
            idempotencyKey: 'included',
            now: new Date(1),
        })

        const result = await recordHostedRuntimeUsageEvent({
            env,
            workspaceId: 'workspace_1',
            providerCandidate: 'user_key',
            idempotencyKey: 'runtime:workspace_1:room_1:1:11:tool.web_search',
            event: {
                roomId: 'room_1',
                sessionKey: 'thread_1',
                runId: 'run_1',
                jobId: null,
                kind: 'tool',
                provider: 'brave',
                model: 'brave-search',
                toolName: 'web_search',
                inputTokens: null,
                outputTokens: null,
                cachedTokens: null,
                reasoningTokens: null,
                totalTokens: null,
                durationMs: 1000,
                activeDurationMs: null,
                idleDurationMs: null,
                estimatedCostUsd: null,
                metadata: {
                    payload: {
                        web: {
                            results: [
                                {
                                    title: 'Result',
                                    url: 'https://example.test',
                                },
                            ],
                        },
                    },
                },
            },
            now: new Date(2),
        })

        expect(result.debitedCents).toBe(0)
        expect(result.ledgerEntryId).toBeNull()
        expect(db.ledger.size).toBe(1)
        const usage = Array.from(db.usage.values())[0]!
        expect(usage.provider).toBe('brave')
        expect(usage.billingStatus).toBe('not_billable')
        expect(usage.costMicros).toBeNull()
        expect(db.accounts.get('workspace_1')?.includedBalanceCents).toBe(100)
    })
})

describe('hosted billing included credit expiry', () => {
    it('clears leftover included credit and writes an included_credit_expiry debit', async () => {
        const db = new FakeD1()
        const env = hostedEnv(db)
        await ensureHostedBillingAccount({
            env,
            workspaceId: 'workspace_1',
            now: new Date(0),
        })
        await creditHostedBalance({
            env,
            workspaceId: 'workspace_1',
            source: 'subscription_included_credit',
            amountCents: 40,
            idempotencyKey: 'included',
            now: new Date(1),
        })
        await creditHostedBalance({
            env,
            workspaceId: 'workspace_1',
            source: 'stripe_topup',
            amountCents: 60,
            idempotencyKey: 'topup',
            now: new Date(2),
        })

        const expiry = await expireIncludedBalance({
            env,
            workspaceId: 'workspace_1',
            idempotencyKey: 'expire_1',
            now: new Date(3),
        })
        expect(expiry?.direction).toBe('debit')
        expect(expiry?.source).toBe('included_credit_expiry')
        expect(expiry?.amountCents).toBe(40)
        expect(expiry?.balanceAfterCents).toBe(60)
        const account = db.accounts.get('workspace_1')!
        expect(account.includedBalanceCents).toBe(0)
        expect(account.purchasedBalanceCents).toBe(60)

        const noop = await expireIncludedBalance({
            env,
            workspaceId: 'workspace_1',
            idempotencyKey: 'expire_2',
            now: new Date(4),
        })
        expect(noop).toBeNull()
    })

    it('preserves included credit that backs active reservations', async () => {
        const db = new FakeD1()
        const env = hostedEnv(db)
        await ensureHostedBillingAccount({
            env,
            workspaceId: 'workspace_1',
            now: new Date(0),
        })
        await creditHostedBalance({
            env,
            workspaceId: 'workspace_1',
            source: 'subscription_included_credit',
            amountCents: 40,
            idempotencyKey: 'included',
            now: new Date(1),
        })
        await authorizeHostedBillingReservation({
            env,
            workspaceId: 'workspace_1',
            roomId: 'room_1',
            provider: 'openrouter',
            amountCents: 15,
            idempotencyKey: 'reservation_1',
            expiresAt: new Date(Date.now() + 60_000),
            now: new Date(2),
        })

        const expiry = await expireIncludedBalance({
            env,
            workspaceId: 'workspace_1',
            idempotencyKey: 'expire_reserved',
            now: new Date(3),
        })

        expect(expiry?.amountCents).toBe(25)
        expect(expiry?.balanceAfterCents).toBe(15)
        const account = db.accounts.get('workspace_1')!
        expect(account.includedBalanceCents).toBe(15)
        expect(account.includedReservedCents).toBe(15)
        expect(account.purchasedBalanceCents).toBe(0)
    })
})

describe('hosted billing service API', () => {
    it('returns summary actions and creates checkout sessions with workspace metadata', async () => {
        const db = new FakeD1()
        const env = stripeHostedEnv(db)
        const actor = {
            authProvider: 'better-auth' as const,
            userId: 'user_1',
            sessionId: 'session_1',
            email: 'user@example.test',
            workspaceId: 'workspace_1',
        }
        const fetchMock = vi.fn<(...args: Parameters<typeof fetch>) => Promise<Response>>(
            async () =>
                new Response(
                    JSON.stringify({
                        url: 'https://checkout.stripe.test/session',
                    }),
                    {
                        status: 200,
                    },
                ),
        )
        vi.stubGlobal('fetch', fetchMock)

        const summary = await readHostedBillingSummary({
            env,
            actor,
        })
        expect(summary.account).toMatchObject({
            workspaceId: 'workspace_1',
            includedBalanceCents: 0,
            purchasedBalanceCents: 0,
            currentBalanceCents: 0,
            includedMonthlyCreditCents: 0,
        })
        expect(summary.remainingUsageCents).toBe(0)
        expect(summary.usageMarkupBps).toBe(13000)
        expect(summary.taxMode).toBe('automatic')
        expect(summary.activePlanKey).toBe('none')
        expect(summary.plans.map((plan) => plan.key)).toEqual(['starter', 'standard', 'pro'])
        expect(summary.actions.some((action) => action.kind === 'credit_topup')).toBe(true)
        expect(
            summary.actions
                .filter((action) => action.kind === 'subscription')
                .map((a) => a.planKey),
        ).toEqual(['starter', 'standard', 'pro'])
        expect(summary.actions.every((action) => action.enabled)).toBe(true)
        expect(summary.providerPriority).toEqual(['user_key', 'codex', 'hosted_openrouter'])

        await expect(
            createHostedStripeCheckout({
                env,
                actor,
                kind: 'credit_topup',
            }),
        ).resolves.toEqual({
            url: 'https://checkout.stripe.test/session',
        })

        const [, init] = fetchMock.mock.calls[0] ?? []
        expect(init?.headers).toMatchObject({
            authorization: 'Bearer stripe-secret-test-value',
        })
        expect(String(init?.body)).toContain('metadata%5Bworkspace_id%5D=workspace_1')
        expect(String(init?.body)).toContain('line_items%5B0%5D%5Bprice%5D=price_test_topup_000000')
        expect(String(init?.body)).toContain('automatic_tax%5Benabled%5D=true')

        await createHostedStripeCheckout({
            env,
            actor,
            kind: 'subscription',
            planKey: 'standard',
        })
        const [, subscriptionInit] = fetchMock.mock.calls[1] ?? []
        expect(String(subscriptionInit?.body)).toContain(
            'line_items%5B0%5D%5Bprice%5D=price_test_standard_000000',
        )
        expect(String(subscriptionInit?.body)).toContain('metadata%5Bplan_key%5D=standard')
        expect(String(subscriptionInit?.body)).toContain(
            'subscription_data%5Bmetadata%5D%5Bworkspace_id%5D=workspace_1',
        )
    })

    it('includes automatic_tax when the tax mode is automatic', async () => {
        const db = new FakeD1()
        const env = stripeHostedEnv(db)
        const actor = {
            authProvider: 'better-auth' as const,
            userId: 'user_1',
            sessionId: 'session_1',
            email: 'user@example.test',
            workspaceId: 'workspace_1',
        }
        const fetchMock = vi.fn<(...args: Parameters<typeof fetch>) => Promise<Response>>(
            async () =>
                new Response(JSON.stringify({ url: 'https://checkout.stripe.test/session' }), {
                    status: 200,
                }),
        )
        vi.stubGlobal('fetch', fetchMock)

        await createHostedStripeCheckout({
            env,
            actor,
            kind: 'subscription',
            planKey: 'pro',
        })
        const [, init] = fetchMock.mock.calls[0] ?? []
        const body = String(init?.body)
        expect(body).toContain('automatic_tax%5Benabled%5D=true')
        expect(body).toContain('billing_address_collection=required')
    })
})
