import { afterEach, describe, expect, it, vi } from 'vitest'
import { ensureHostedBillingAccount } from './hosted-billing-repository'
import { verifyStripeWebhookPayload } from './hosted-stripe'
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
                                    id: 'price_test_standard_000000',
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
                        data: [{ price: { id: 'price_test_standard_000000' } }],
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
