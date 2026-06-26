import { afterEach, describe, expect, it, vi } from 'vitest'
import { hostedBillingCatalog } from '@agent-room/billing'
import { ensureHostedBillingAccount } from './hosted-billing-repository'
import { createHostedStripePortalSession, verifyStripeWebhookPayload } from './hosted-stripe'
import {
    FakeD1,
    deliverStripeEvent,
    stripeHostedEnv,
    stripeSignature,
} from './hosted-billing-test-support'

afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
})

const standardPlan = hostedBillingCatalog.plans.find((plan) => plan.key === 'standard')!
const proPlan = hostedBillingCatalog.plans.find((plan) => plan.key === 'pro')!

describe('hosted billing stripe webhooks', () => {
    it('credits the purchased bucket with the pre-tax subtotal on a top-up', async () => {
        const db = new FakeD1()
        const env = stripeHostedEnv(db)
        await ensureHostedBillingAccount({
            env,
            workspaceId: 'workspace_1',
            now: new Date(0),
        })

        const result = await deliverStripeEvent({
            env,
            secret: 'stripe-webhook-test-value',
            event: {
                id: 'evt_topup',
                type: 'checkout.session.completed',
                livemode: false,
                data: {
                    object: {
                        id: 'cs_topup',
                        customer: 'cus_1',
                        subscription: null,
                        mode: 'payment',
                        payment_status: 'paid',
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
        expect(result.processed).toBe(true)

        const account = db.accounts.get('workspace_1')!
        expect(account.purchasedBalanceCents).toBe(1000)
        expect(account.includedBalanceCents).toBe(0)
        const ledgerEntry = Array.from(db.ledger.values()).find(
            (entry) => entry.source === 'stripe_topup',
        )!
        expect(ledgerEntry.amountCents).toBe(1000)
        expect(ledgerEntry.metadata).toContain('"amountSubtotalCents":1000')
    })

    it('resets included credit monthly: leftover is expired then re-granted', async () => {
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
        account.purchasedBalanceCents = 300

        const invoiceEvent = (eventId: string, invoiceId: string) => ({
            id: eventId,
            type: 'invoice.paid',
            livemode: false,
            data: {
                object: {
                    id: invoiceId,
                    customer: 'cus_1',
                    subscription: 'sub_1',
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
        })

        await deliverStripeEvent({
            env,
            secret: 'stripe-webhook-test-value',
            event: invoiceEvent('evt_invoice_1', 'in_1'),
        })
        const afterFirst = db.accounts.get('workspace_1')!
        expect(afterFirst.includedBalanceCents).toBe(1200)
        expect(afterFirst.includedMonthlyCreditCents).toBe(1200)
        expect(afterFirst.purchasedBalanceCents).toBe(300)

        afterFirst.includedBalanceCents = 400

        await deliverStripeEvent({
            env,
            secret: 'stripe-webhook-test-value',
            event: invoiceEvent('evt_invoice_2', 'in_2'),
        })
        const afterSecond = db.accounts.get('workspace_1')!
        expect(afterSecond.includedBalanceCents).toBe(1200)
        expect(afterSecond.purchasedBalanceCents).toBe(300)
        const expiryEntries = Array.from(db.ledger.values()).filter(
            (entry) => entry.source === 'included_credit_expiry',
        )
        expect(expiryEntries).toHaveLength(1)
        expect(expiryEntries[0].amountCents).toBe(400)
        expect(expiryEntries[0].balanceAfterCents).toBe(300)
    })

    it('leaves the event unrecorded when processing throws, so a Stripe retry applies the credit exactly once', async () => {
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

        const invoiceEvent = {
            id: 'evt_retry_once',
            type: 'invoice.paid',
            livemode: false,
            data: {
                object: {
                    id: 'in_retry',
                    customer: 'cus_1',
                    subscription: 'sub_1',
                    status: 'paid',
                    metadata: { workspace_id: 'workspace_1' },
                    lines: {
                        data: [{ price: { id: standardPlan.priceId } }],
                    },
                },
            },
        }

        const creditSpy = vi.spyOn(
            await import('./hosted-billing-repository'),
            'creditHostedBalance',
        )
        creditSpy.mockRejectedValueOnce(new Error('transient failure'))

        await expect(
            deliverStripeEvent({
                env,
                secret: 'stripe-webhook-test-value',
                event: invoiceEvent,
            }),
        ).rejects.toThrow(/transient failure/)

        expect(db.stripeEvents.has('evt_retry_once')).toBe(false)
        expect(db.accounts.get('workspace_1')?.includedBalanceCents).toBe(0)

        creditSpy.mockRestore()

        const retryResult = await deliverStripeEvent({
            env,
            secret: 'stripe-webhook-test-value',
            event: invoiceEvent,
        })
        expect(retryResult.processed).toBe(true)
        expect(db.stripeEvents.has('evt_retry_once')).toBe(true)
        expect(db.accounts.get('workspace_1')?.includedBalanceCents).toBe(1200)

        const creditEntries = Array.from(db.ledger.values()).filter(
            (entry) => entry.source === 'subscription_included_credit',
        )
        expect(creditEntries).toHaveLength(1)
        expect(creditEntries[0].amountCents).toBe(1200)
    })

    it('updates hosted plan access from Stripe subscription status events', async () => {
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
                id: 'evt_subscription_updated',
                type: 'customer.subscription.updated',
                livemode: false,
                data: {
                    object: {
                        id: 'sub_1',
                        customer: 'cus_1',
                        status: 'past_due',
                        metadata: {
                            workspace_id: 'workspace_1',
                            plan_key: 'pro',
                        },
                        items: {
                            data: [
                                {
                                    price: {
                                        id: proPlan.priceId,
                                    },
                                },
                            ],
                        },
                    },
                },
            },
        })

        const account = db.accounts.get('workspace_1')!
        expect(account.stripeCustomerId).toBe('cus_1')
        expect(account.stripeSubscriptionId).toBe('sub_1')
        expect(account.planKey).toBe('pro')
        expect(account.planStatus).toBe('past_due')
        expect(account.includedMonthlyCreditCents).toBe(3500)
    })

    it('cancels hosted runtime access from Stripe subscription deleted events', async () => {
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
        account.includedMonthlyCreditCents = 1200

        await deliverStripeEvent({
            env,
            secret: 'stripe-webhook-test-value',
            event: {
                id: 'evt_subscription_deleted',
                type: 'customer.subscription.deleted',
                livemode: false,
                data: {
                    object: {
                        id: 'sub_1',
                        customer: 'cus_1',
                        status: 'canceled',
                        metadata: {},
                        items: {
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
            },
        })

        const updated = db.accounts.get('workspace_1')!
        expect(updated.planStatus).toBe('canceled')
        expect(updated.planKey).toBe('standard')
        expect(updated.includedMonthlyCreditCents).toBe(1200)
    })
})

describe('hosted billing Stripe portal', () => {
    it('creates a customer portal session for the hosted billing account', async () => {
        const db = new FakeD1()
        const env = stripeHostedEnv(db)
        await ensureHostedBillingAccount({
            env,
            workspaceId: 'workspace_1',
            now: new Date(0),
        })
        const account = db.accounts.get('workspace_1')!
        account.stripeCustomerId = 'cus_1'
        const fetchMock = vi.fn(
            async (_input: Parameters<typeof fetch>[0], _init?: Parameters<typeof fetch>[1]) =>
                new Response(
                    JSON.stringify({
                        url: 'https://billing.stripe.com/p/session_1',
                    }),
                    {
                        status: 200,
                        headers: {
                            'content-type': 'application/json',
                        },
                    },
                ),
        )
        vi.stubGlobal('fetch', fetchMock)

        const result = await createHostedStripePortalSession({
            env,
            actor: {
                authProvider: 'better-auth',
                userId: 'user_1',
                sessionId: 'session_1',
                email: 'user@example.test',
                workspaceId: 'workspace_1',
            },
        })

        expect(result.url).toBe('https://billing.stripe.com/p/session_1')
        expect(fetchMock).toHaveBeenCalledTimes(1)
        const [url, init] = fetchMock.mock.calls[0]!
        expect(String(url)).toBe('https://api.stripe.com/v1/billing_portal/sessions')
        expect((init as RequestInit).method).toBe('POST')
        expect(new Headers((init as RequestInit).headers).get('authorization')).toBe(
            'Bearer stripe-secret-test-value',
        )
        expect(String((init as RequestInit).body)).toContain('customer=cus_1')
        expect(String((init as RequestInit).body)).toContain(
            'return_url=https%3A%2F%2Frooms.example.test%2Fbilling',
        )
    })
})

describe('hosted Stripe webhook verification', () => {
    it('accepts a valid Stripe signature and rejects an invalid one', async () => {
        const body = JSON.stringify({
            id: 'evt_placeholder',
            type: 'checkout.session.completed',
            livemode: false,
            data: {
                object: {},
            },
        })
        const timestamp = 1000
        const signature = await stripeSignature({
            secret: 'stripe-webhook-test-value',
            body,
            timestamp,
        })
        await expect(
            verifyStripeWebhookPayload({
                secret: 'stripe-webhook-test-value',
                body,
                signatureHeader: `t=${timestamp},v1=${signature}`,
                nowSeconds: timestamp,
            }),
        ).resolves.toMatchObject({
            id: 'evt_placeholder',
        })
        await expect(
            verifyStripeWebhookPayload({
                secret: 'stripe-webhook-test-value',
                body,
                signatureHeader: `t=${timestamp},v1=bad`,
                nowSeconds: timestamp,
            }),
        ).rejects.toThrow(/verification failed/)
    })
})
