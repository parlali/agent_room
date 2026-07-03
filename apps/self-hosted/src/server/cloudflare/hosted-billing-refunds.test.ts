import { afterEach, describe, expect, it, vi } from 'vitest'
import { hostedBillingCatalog } from '@agent-room/billing'
import {
    authorizeHostedBillingReservation,
    creditHostedBalance,
    ensureHostedBillingAccount,
} from './hosted-billing-repository'
import { HostedBillingFrozenError } from './hosted-billing-types'
import {
    createHostedStripeCheckout,
    HostedStripeCheckoutBlockedError,
    readHostedBillingSummary,
} from './hosted-stripe'
import { sweepHostedBillingSettlements } from './hosted-usage-billing'
import {
    FakeD1,
    deliverStripeEvent,
    hostedEnv,
    stripeHostedEnv,
} from './hosted-billing-test-support'

afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
})

const standardPlan = hostedBillingCatalog.plans.find((plan) => plan.key === 'standard')!

const actor = {
    authProvider: 'better-auth' as const,
    userId: 'user_1',
    sessionId: 'session_1',
    email: 'user@example.test',
    workspaceId: 'workspace_1',
}

function stubStripeCheckoutFetch() {
    const fetchMock = vi.fn<(...args: Parameters<typeof fetch>) => Promise<Response>>(
        async () =>
            new Response(JSON.stringify({ url: 'https://checkout.stripe.test/session' }), {
                status: 200,
            }),
    )
    vi.stubGlobal('fetch', fetchMock)
    return fetchMock
}

async function deliverTopupCompleted(input: {
    env: ReturnType<typeof stripeHostedEnv>
    eventId?: string
    sessionId?: string
    customer?: string
    paymentIntent?: string
    amountSubtotal?: number
}) {
    return deliverStripeEvent({
        env: input.env,
        secret: 'stripe-webhook-test-value',
        event: {
            id: input.eventId ?? 'evt_topup',
            type: 'checkout.session.completed',
            livemode: false,
            data: {
                object: {
                    id: input.sessionId ?? 'cs_topup',
                    customer: input.customer ?? 'cus_1',
                    subscription: null,
                    payment_intent: input.paymentIntent ?? 'pi_1',
                    mode: 'payment',
                    payment_status: 'paid',
                    amount_total: 1200,
                    amount_subtotal: input.amountSubtotal ?? 1000,
                    metadata: {
                        workspace_id: 'workspace_1',
                        user_id: 'user_1',
                        kind: 'credit_topup',
                    },
                },
            },
        },
    })
}

describe('hosted billing checkout customer binding', () => {
    it('blocks subscription checkout while an active subscription exists and disables the action', async () => {
        const db = new FakeD1()
        const env = stripeHostedEnv(db)
        stubStripeCheckoutFetch()
        await ensureHostedBillingAccount({
            env,
            workspaceId: 'workspace_1',
            now: new Date(0),
        })
        const account = db.accounts.get('workspace_1')!
        account.stripeCustomerId = 'cus_1'
        account.stripeSubscriptionId = 'sub_1'
        account.planKey = 'standard'
        account.planStatus = 'active'

        await expect(
            createHostedStripeCheckout({
                env,
                actor,
                kind: 'subscription',
                planKey: 'pro',
            }),
        ).rejects.toBeInstanceOf(HostedStripeCheckoutBlockedError)

        const summary = await readHostedBillingSummary({
            env,
            actor,
        })
        expect(
            summary.actions
                .filter((action) => action.kind === 'subscription')
                .every((action) => !action.enabled),
        ).toBe(true)
        expect(summary.actions.find((action) => action.kind === 'credit_topup')?.enabled).toBe(true)
    })

    it('reuses the stored Stripe customer for top-ups instead of creating a new one', async () => {
        const db = new FakeD1()
        const env = stripeHostedEnv(db)
        const fetchMock = stubStripeCheckoutFetch()
        await ensureHostedBillingAccount({
            env,
            workspaceId: 'workspace_1',
            now: new Date(0),
        })
        db.accounts.get('workspace_1')!.stripeCustomerId = 'cus_existing'

        await createHostedStripeCheckout({
            env,
            actor,
            kind: 'credit_topup',
        })
        const [, init] = fetchMock.mock.calls[0] ?? []
        const body = String(init?.body)
        expect(body).toContain('customer=cus_existing')
        expect(body).not.toContain('customer_creation=always')
        expect(body).toContain('customer_update%5Baddress%5D=auto')
    })

    it('forces customer creation for top-ups when no customer is stored yet', async () => {
        const db = new FakeD1()
        const env = stripeHostedEnv(db)
        const fetchMock = stubStripeCheckoutFetch()

        await createHostedStripeCheckout({
            env,
            actor,
            kind: 'credit_topup',
        })
        const [, init] = fetchMock.mock.calls[0] ?? []
        const body = String(init?.body)
        expect(body).toContain('customer_creation=always')
        expect(body).not.toContain('customer=cus')
    })

    it('rejects a webhook customer that differs from the stored customer and keeps the stored id', async () => {
        const db = new FakeD1()
        const env = stripeHostedEnv(db)
        await ensureHostedBillingAccount({
            env,
            workspaceId: 'workspace_1',
            now: new Date(0),
        })
        const account = db.accounts.get('workspace_1')!
        account.stripeCustomerId = 'cus_stored'
        account.stripeSubscriptionId = 'sub_stored'
        account.planStatus = 'active'

        await deliverTopupCompleted({
            env,
            customer: 'cus_other',
        })

        const updated = db.accounts.get('workspace_1')!
        expect(updated.stripeCustomerId).toBe('cus_stored')
        expect(updated.stripeSubscriptionId).toBe('sub_stored')
        expect(
            db.audits.some((audit) => audit.action === 'hosted_billing_stripe_customer_mismatch'),
        ).toBe(true)
        expect(updated.purchasedBalanceCents).toBe(1000)
        const credit = Array.from(db.ledger.values()).find(
            (entry) => entry.source === 'stripe_topup',
        )!
        expect(credit.metadata).toContain('"stripeCustomerMismatch":true')
    })
})

describe('hosted billing subscription activation gating', () => {
    it('does not activate a subscription checkout that is not paid yet', async () => {
        const db = new FakeD1()
        const env = stripeHostedEnv(db)
        await ensureHostedBillingAccount({
            env,
            workspaceId: 'workspace_1',
            now: new Date(0),
        })

        await deliverStripeEvent({
            env,
            secret: 'stripe-webhook-test-value',
            event: {
                id: 'evt_sub_unpaid',
                type: 'checkout.session.completed',
                livemode: false,
                data: {
                    object: {
                        id: 'cs_sub',
                        customer: 'cus_1',
                        subscription: 'sub_1',
                        payment_intent: null,
                        mode: 'subscription',
                        payment_status: 'unpaid',
                        amount_total: 2000,
                        amount_subtotal: 2000,
                        metadata: {
                            workspace_id: 'workspace_1',
                            user_id: 'user_1',
                            kind: 'subscription',
                            plan_key: 'standard',
                        },
                    },
                },
            },
        })

        const account = db.accounts.get('workspace_1')!
        expect(account.planStatus).toBe('none')
        expect(account.stripeSubscriptionId).toBe('sub_1')
    })
})

describe('hosted billing stale webhook guards', () => {
    function invoicePaidEvent(eventId: string, subscriptionId: string) {
        return {
            id: eventId,
            type: 'invoice.paid',
            livemode: false,
            data: {
                object: {
                    id: `in_${eventId}`,
                    customer: 'cus_1',
                    subscription: subscriptionId,
                    status: 'paid',
                    metadata: {
                        workspace_id: 'workspace_1',
                    },
                    lines: {
                        data: [
                            {
                                price: {
                                    id: standardPlan.priceId,
                                },
                            },
                        ],
                    },
                },
            },
        }
    }

    it('never resurrects a canceled subscription from a late invoice.paid', async () => {
        const db = new FakeD1()
        const env = stripeHostedEnv(db)
        await ensureHostedBillingAccount({
            env,
            workspaceId: 'workspace_1',
            now: new Date(0),
        })
        const account = db.accounts.get('workspace_1')!
        account.stripeCustomerId = 'cus_1'
        account.stripeSubscriptionId = 'sub_1'
        account.planKey = 'standard'
        account.planStatus = 'active'

        await deliverStripeEvent({
            env,
            secret: 'stripe-webhook-test-value',
            event: {
                id: 'evt_sub_deleted',
                type: 'customer.subscription.deleted',
                livemode: false,
                data: {
                    object: {
                        id: 'sub_1',
                        customer: 'cus_1',
                        status: 'canceled',
                        metadata: {},
                        items: {
                            data: [{ price: { id: standardPlan.priceId } }],
                        },
                    },
                },
            },
        })
        expect(db.accounts.get('workspace_1')!.planStatus).toBe('canceled')

        const result = await deliverStripeEvent({
            env,
            secret: 'stripe-webhook-test-value',
            event: invoicePaidEvent('evt_late_invoice', 'sub_1'),
        })
        expect(result.processed).toBe(true)

        const after = db.accounts.get('workspace_1')!
        expect(after.planStatus).toBe('canceled')
        expect(after.includedBalanceCents).toBe(0)
        expect(
            Array.from(db.ledger.values()).some(
                (entry) => entry.source === 'subscription_included_credit',
            ),
        ).toBe(false)
    })

    it('ignores an invoice for a subscription that is no longer current', async () => {
        const db = new FakeD1()
        const env = stripeHostedEnv(db)
        await ensureHostedBillingAccount({
            env,
            workspaceId: 'workspace_1',
            now: new Date(0),
        })
        const account = db.accounts.get('workspace_1')!
        account.stripeCustomerId = 'cus_1'
        account.stripeSubscriptionId = 'sub_2'
        account.planKey = 'standard'
        account.planStatus = 'active'

        await deliverStripeEvent({
            env,
            secret: 'stripe-webhook-test-value',
            event: invoicePaidEvent('evt_old_sub_invoice', 'sub_1'),
        })

        const after = db.accounts.get('workspace_1')!
        expect(after.stripeSubscriptionId).toBe('sub_2')
        expect(after.includedBalanceCents).toBe(0)
    })

    it('ignores a late subscription.deleted for a replaced subscription', async () => {
        const db = new FakeD1()
        const env = stripeHostedEnv(db)
        await ensureHostedBillingAccount({
            env,
            workspaceId: 'workspace_1',
            now: new Date(0),
        })
        const account = db.accounts.get('workspace_1')!
        account.stripeCustomerId = 'cus_1'
        account.stripeSubscriptionId = 'sub_2'
        account.planKey = 'standard'
        account.planStatus = 'active'

        await deliverStripeEvent({
            env,
            secret: 'stripe-webhook-test-value',
            event: {
                id: 'evt_old_sub_deleted',
                type: 'customer.subscription.deleted',
                livemode: false,
                data: {
                    object: {
                        id: 'sub_1',
                        customer: 'cus_1',
                        status: 'canceled',
                        metadata: {
                            workspace_id: 'workspace_1',
                        },
                        items: {
                            data: [{ price: { id: standardPlan.priceId } }],
                        },
                    },
                },
            },
        })

        expect(db.accounts.get('workspace_1')!.planStatus).toBe('active')
        expect(db.accounts.get('workspace_1')!.stripeSubscriptionId).toBe('sub_2')
    })
})

describe('hosted billing refund and dispute clawback', () => {
    it('claws back a refunded top-up down to the exact credited amount', async () => {
        const db = new FakeD1()
        const env = stripeHostedEnv(db)
        await ensureHostedBillingAccount({
            env,
            workspaceId: 'workspace_1',
            now: new Date(0),
        })
        await deliverTopupCompleted({ env })
        expect(db.accounts.get('workspace_1')!.purchasedBalanceCents).toBe(1000)

        await deliverStripeEvent({
            env,
            secret: 'stripe-webhook-test-value',
            event: {
                id: 'evt_refund',
                type: 'charge.refunded',
                livemode: false,
                data: {
                    object: {
                        id: 'ch_1',
                        payment_intent: 'pi_1',
                        amount_refunded: 1000,
                        refunded: true,
                        metadata: {},
                    },
                },
            },
        })

        const account = db.accounts.get('workspace_1')!
        expect(account.purchasedBalanceCents).toBe(0)
        expect(account.billingFrozen).toBe(0)
        const clawback = Array.from(db.ledger.values()).find(
            (entry) => entry.source === 'stripe_refund_clawback',
        )!
        expect(clawback.direction).toBe('debit')
        expect(clawback.amountCents).toBe(1000)
        expect(clawback.stripePaymentIntentId).toBe('pi_1')
        expect(db.audits.some((audit) => audit.action === 'hosted_billing_refund_clawback')).toBe(
            true,
        )
    })

    it('handles cumulative partial refunds without double clawback', async () => {
        const db = new FakeD1()
        const env = stripeHostedEnv(db)
        await ensureHostedBillingAccount({
            env,
            workspaceId: 'workspace_1',
            now: new Date(0),
        })
        await deliverTopupCompleted({ env })

        const refundEvent = (eventId: string, amountRefunded: number) => ({
            id: eventId,
            type: 'charge.refunded',
            livemode: false,
            data: {
                object: {
                    id: 'ch_1',
                    payment_intent: 'pi_1',
                    amount_refunded: amountRefunded,
                    refunded: amountRefunded >= 1000,
                    metadata: {},
                },
            },
        })

        await deliverStripeEvent({
            env,
            secret: 'stripe-webhook-test-value',
            event: refundEvent('evt_refund_partial', 400),
        })
        expect(db.accounts.get('workspace_1')!.purchasedBalanceCents).toBe(600)

        await deliverStripeEvent({
            env,
            secret: 'stripe-webhook-test-value',
            event: refundEvent('evt_refund_full', 1000),
        })
        expect(db.accounts.get('workspace_1')!.purchasedBalanceCents).toBe(0)

        const clawbacks = Array.from(db.ledger.values()).filter(
            (entry) => entry.source === 'stripe_refund_clawback',
        )
        expect(clawbacks.map((entry) => entry.amountCents).sort()).toEqual([400, 600])
    })

    it('debits to zero, records the shortfall, and freezes when the refund exceeds the balance', async () => {
        const db = new FakeD1()
        const env = stripeHostedEnv(db)
        await ensureHostedBillingAccount({
            env,
            workspaceId: 'workspace_1',
            now: new Date(0),
        })
        await deliverTopupCompleted({ env })
        db.accounts.get('workspace_1')!.purchasedBalanceCents = 300

        await deliverStripeEvent({
            env,
            secret: 'stripe-webhook-test-value',
            event: {
                id: 'evt_refund_shortfall',
                type: 'charge.refunded',
                livemode: false,
                data: {
                    object: {
                        id: 'ch_1',
                        payment_intent: 'pi_1',
                        amount_refunded: 1000,
                        refunded: true,
                        metadata: {},
                    },
                },
            },
        })

        const account = db.accounts.get('workspace_1')!
        expect(account.purchasedBalanceCents).toBe(0)
        expect(account.billingFrozen).toBe(1)
        const clawback = Array.from(db.ledger.values()).find(
            (entry) => entry.source === 'stripe_refund_clawback',
        )!
        expect(clawback.amountCents).toBe(300)
        expect(clawback.metadata).toContain('"shortfallCents":700')

        await expect(
            authorizeHostedBillingReservation({
                env,
                workspaceId: 'workspace_1',
                roomId: 'room_1',
                provider: 'openrouter',
                amountCents: 1,
                idempotencyKey: 'frozen_reservation',
                expiresAt: new Date(Date.now() + 60_000),
            }),
        ).rejects.toBeInstanceOf(HostedBillingFrozenError)
    })

    it('claws back and always freezes on a dispute', async () => {
        const db = new FakeD1()
        const env = stripeHostedEnv(db)
        await ensureHostedBillingAccount({
            env,
            workspaceId: 'workspace_1',
            now: new Date(0),
        })
        await deliverTopupCompleted({ env })

        await deliverStripeEvent({
            env,
            secret: 'stripe-webhook-test-value',
            event: {
                id: 'evt_dispute',
                type: 'charge.dispute.created',
                livemode: false,
                data: {
                    object: {
                        id: 'dp_1',
                        charge: 'ch_1',
                        payment_intent: 'pi_1',
                        amount: 1000,
                        metadata: {},
                    },
                },
            },
        })

        const account = db.accounts.get('workspace_1')!
        expect(account.purchasedBalanceCents).toBe(0)
        expect(account.billingFrozen).toBe(1)
        expect(
            Array.from(db.ledger.values()).some(
                (entry) => entry.source === 'stripe_dispute_clawback',
            ),
        ).toBe(true)
        expect(db.audits.some((audit) => audit.action === 'hosted_billing_dispute_clawback')).toBe(
            true,
        )
    })

    it('claws back a credited async top-up when the async payment fails', async () => {
        const db = new FakeD1()
        const env = stripeHostedEnv(db)
        await ensureHostedBillingAccount({
            env,
            workspaceId: 'workspace_1',
            now: new Date(0),
        })
        await deliverTopupCompleted({ env })
        expect(db.accounts.get('workspace_1')!.purchasedBalanceCents).toBe(1000)

        await deliverStripeEvent({
            env,
            secret: 'stripe-webhook-test-value',
            event: {
                id: 'evt_async_failed',
                type: 'checkout.session.async_payment_failed',
                livemode: false,
                data: {
                    object: {
                        id: 'cs_topup',
                        customer: 'cus_1',
                        subscription: null,
                        payment_intent: 'pi_1',
                        mode: 'payment',
                        payment_status: 'unpaid',
                        amount_total: 1200,
                        amount_subtotal: 1000,
                        metadata: {
                            workspace_id: 'workspace_1',
                            user_id: 'user_1',
                            kind: 'credit_topup',
                        },
                    },
                },
            },
        })

        expect(db.accounts.get('workspace_1')!.purchasedBalanceCents).toBe(0)
    })
})

describe('hosted billing settlement sweep', () => {
    it('settles a stale pending usage event and settles its still-authorized reservation', async () => {
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
            amountCents: 20,
            idempotencyKey: 'sweep_reservation',
            expiresAt: new Date(30 * 60_000),
            now: new Date(2),
        })
        db.usage.set('usage_stale', {
            id: 'usage_stale',
            workspaceId: 'workspace_1',
            roomId: 'room_1',
            kind: 'provider',
            provider: 'openrouter',
            model: 'openrouter/auto',
            costMicros: 100000,
            billingStatus: 'pending',
            billingLedgerEntryId: null,
            idempotencyKey: 'provider_proxy:openrouter:workspace_1:room_1:req_1',
            metadata: JSON.stringify({ reservationId: reservation.id }),
            createdAt: new Date(3).toISOString(),
        })

        const result = await sweepHostedBillingSettlements({
            env,
            now: new Date(10 * 60_000),
        })

        expect(result.scanned).toBe(1)
        expect(result.settled).toBe(1)
        expect(result.blocked).toBe(0)
        expect(result.failed).toBe(0)
        expect(db.usage.get('usage_stale')?.billingStatus).toBe('debited')
        expect(db.reservations.get(reservation.id)?.status).toBe('settled')
        const account = db.accounts.get('workspace_1')!
        expect(account.includedBalanceCents).toBe(87)
        expect(account.includedReservedCents).toBe(0)
    })

    it('is idempotent and skips fresh pending events', async () => {
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
        const now = new Date(10 * 60_000)
        db.usage.set('usage_fresh', {
            id: 'usage_fresh',
            workspaceId: 'workspace_1',
            roomId: 'room_1',
            kind: 'provider',
            provider: 'openrouter',
            model: 'openrouter/auto',
            costMicros: 100000,
            billingStatus: 'pending',
            billingLedgerEntryId: null,
            idempotencyKey: 'provider_proxy:openrouter:workspace_1:room_1:req_fresh',
            metadata: '{}',
            createdAt: new Date(now.getTime() - 60_000).toISOString(),
        })
        db.usage.set('usage_stale', {
            id: 'usage_stale',
            workspaceId: 'workspace_1',
            roomId: 'room_1',
            kind: 'provider',
            provider: 'openrouter',
            model: 'openrouter/auto',
            costMicros: 100000,
            billingStatus: 'pending',
            billingLedgerEntryId: null,
            idempotencyKey: 'provider_proxy:openrouter:workspace_1:room_1:req_stale',
            metadata: '{}',
            createdAt: new Date(3).toISOString(),
        })

        const first = await sweepHostedBillingSettlements({ env, now })
        const second = await sweepHostedBillingSettlements({ env, now })

        expect(first.scanned).toBe(1)
        expect(first.settled).toBe(1)
        expect(second.scanned).toBe(0)
        expect(db.usage.get('usage_fresh')?.billingStatus).toBe('pending')
        expect(db.usage.get('usage_stale')?.billingStatus).toBe('debited')
        expect(db.accounts.get('workspace_1')?.includedBalanceCents).toBe(87)
        expect(db.ledger.size).toBe(2)
    })

    it('marks stale pending usage blocked when the balance cannot cover it and releases expired holds', async () => {
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
            amountCents: 5,
            idempotencyKey: 'expired_reservation',
            expiresAt: new Date(1000),
            now: new Date(2),
        })
        db.usage.set('usage_expensive', {
            id: 'usage_expensive',
            workspaceId: 'workspace_1',
            roomId: 'room_1',
            kind: 'provider',
            provider: 'openrouter',
            model: 'openrouter/auto',
            costMicros: 10_000_000,
            billingStatus: 'pending',
            billingLedgerEntryId: null,
            idempotencyKey: 'provider_proxy:openrouter:workspace_1:room_1:req_expensive',
            metadata: '{}',
            createdAt: new Date(3).toISOString(),
        })

        const result = await sweepHostedBillingSettlements({
            env,
            now: new Date(10 * 60_000),
        })

        expect(result.releasedReservations).toBe(1)
        expect(db.reservations.get(reservation.id)?.status).toBe('expired')
        expect(result.blocked).toBe(1)
        expect(db.usage.get('usage_expensive')?.billingStatus).toBe('blocked')
        expect(db.accounts.get('workspace_1')?.includedBalanceCents).toBe(10)
    })
})
