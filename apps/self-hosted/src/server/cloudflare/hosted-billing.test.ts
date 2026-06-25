import { describe, expect, it } from 'vitest'
import {
    appendHostedUsageEvent,
    authorizeHostedBillingReservation,
    creditHostedBalance,
    debitHostedBalance,
    ensureHostedBillingAccount,
    readHostedBillingAccount,
    releaseExpiredHostedBillingReservations,
} from './hosted-billing-repository'
import { centsFromMicrosCeil } from './hosted-billing-types'
import {
    assertHostedProviderCreditsAvailable,
    recordHostedProviderUsage,
} from './hosted-usage-billing'
import { FakeD1, hostedEnv, totalBalance } from './hosted-billing-test-support'

describe('hosted billing money units', () => {
    it('settles micros to integer cents without rounding down billable usage', () => {
        expect(centsFromMicrosCeil(0)).toBe(0)
        expect(centsFromMicrosCeil(1)).toBe(1)
        expect(centsFromMicrosCeil(10000)).toBe(1)
        expect(centsFromMicrosCeil(10001)).toBe(2)
    })
})

describe('hosted billing ledger', () => {
    it('credits and debits without allowing the balance below zero', async () => {
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
            source: 'stripe_topup',
            amountCents: 25,
            idempotencyKey: 'topup_1',
            now: new Date(1),
        })
        expect(db.accounts.get('workspace_1')?.purchasedBalanceCents).toBe(25)
        expect(totalBalance(db.accounts.get('workspace_1')!)).toBe(25)

        const usageEventId = await recordHostedProviderUsage({
            env,
            workspaceId: 'workspace_1',
            roomId: 'room_1',
            sessionKey: 'thread_1',
            runId: 'run_1',
            jobId: null,
            provider: 'openrouter',
            model: 'openrouter/auto',
            inputTokens: 1,
            outputTokens: 1,
            cachedTokens: 0,
            costMicros: 20000,
            now: new Date(2),
        })
        expect(usageEventId.debitedCents).toBe(3)
        expect(totalBalance(db.accounts.get('workspace_1')!)).toBe(22)
        db.usage.set('usage_too_large', {
            id: 'usage_too_large',
            workspaceId: 'workspace_1',
            roomId: 'room_1',
            kind: 'provider',
            provider: 'openrouter',
            model: null,
            costMicros: null,
            billingStatus: 'pending',
            billingLedgerEntryId: null,
            idempotencyKey: null,
            createdAt: new Date(3).toISOString(),
        })

        await expect(
            debitHostedBalance({
                env,
                workspaceId: 'workspace_1',
                source: 'hosted_openrouter_usage',
                amountCents: 24,
                usageEventId: 'usage_too_large',
                idempotencyKey: 'usage_too_large',
                now: new Date(3),
            }),
        ).rejects.toThrow(/exhausted/)
        expect(totalBalance(db.accounts.get('workspace_1')!)).toBe(22)
    })

    it('returns the existing ledger entry for repeated idempotency keys', async () => {
        const db = new FakeD1()
        const env = hostedEnv(db)
        await ensureHostedBillingAccount({
            env,
            workspaceId: 'workspace_1',
        })
        await creditHostedBalance({
            env,
            workspaceId: 'workspace_1',
            source: 'stripe_topup',
            amountCents: 10,
            idempotencyKey: 'topup_once',
        })
        await creditHostedBalance({
            env,
            workspaceId: 'workspace_1',
            source: 'stripe_topup',
            amountCents: 10,
            idempotencyKey: 'topup_once',
        })
        expect(db.accounts.get('workspace_1')?.purchasedBalanceCents).toBe(10)
        expect(db.ledger.size).toBe(1)
    })

    it('does not debit balance or insert a ledger entry when the usage event is missing', async () => {
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
            source: 'stripe_topup',
            amountCents: 25,
            idempotencyKey: 'topup_missing_usage',
            now: new Date(1),
        })

        await expect(
            debitHostedBalance({
                env,
                workspaceId: 'workspace_1',
                source: 'hosted_openrouter_usage',
                amountCents: 5,
                usageEventId: 'missing_usage',
                idempotencyKey: 'missing_usage_debit',
                now: new Date(2),
            }),
        ).rejects.toThrow(/existing usage event/)

        expect(totalBalance(db.accounts.get('workspace_1')!)).toBe(25)
        expect(
            Array.from(db.ledger.values()).some((entry) => entry.usageEventId === 'missing_usage'),
        ).toBe(false)
    })

    it('does not debit balance or insert a ledger entry when usage is no longer pending', async () => {
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
            source: 'stripe_topup',
            amountCents: 25,
            idempotencyKey: 'topup_debited_usage',
            now: new Date(1),
        })
        db.usage.set('usage_debited', {
            id: 'usage_debited',
            workspaceId: 'workspace_1',
            roomId: null,
            kind: 'provider',
            provider: 'openrouter',
            model: null,
            costMicros: null,
            billingStatus: 'debited',
            billingLedgerEntryId: 'existing_ledger',
            idempotencyKey: null,
            createdAt: new Date(1).toISOString(),
        })

        await expect(
            debitHostedBalance({
                env,
                workspaceId: 'workspace_1',
                source: 'hosted_openrouter_usage',
                amountCents: 5,
                usageEventId: 'usage_debited',
                idempotencyKey: 'debited_usage_debit',
                now: new Date(2),
            }),
        ).rejects.toThrow(/pending usage/)

        expect(totalBalance(db.accounts.get('workspace_1')!)).toBe(25)
        expect(
            Array.from(db.ledger.values()).some((entry) => entry.usageEventId === 'usage_debited'),
        ).toBe(false)
    })
})

describe('hosted usage event idempotency', () => {
    it('returns a proven existing id for repeated idempotency keys', async () => {
        const db = new FakeD1()
        const env = hostedEnv(db)
        const first = await appendHostedUsageEvent({
            env,
            workspaceId: 'workspace_1',
            roomId: 'room_1',
            sessionKey: null,
            runId: null,
            jobId: null,
            kind: 'provider',
            provider: 'openrouter',
            model: 'openrouter/auto',
            toolName: null,
            inputTokens: null,
            outputTokens: null,
            cachedTokens: null,
            costMicros: 12000,
            billingStatus: 'pending',
            idempotencyKey: 'usage_once',
            now: new Date(0),
        })
        const second = await appendHostedUsageEvent({
            env,
            workspaceId: 'workspace_1',
            roomId: 'room_1',
            sessionKey: null,
            runId: null,
            jobId: null,
            kind: 'provider',
            provider: 'openrouter',
            model: 'openrouter/auto',
            toolName: null,
            inputTokens: null,
            outputTokens: null,
            cachedTokens: null,
            costMicros: 12000,
            billingStatus: 'pending',
            idempotencyKey: 'usage_once',
            now: new Date(1),
        })

        expect(second).toBe(first)
        expect(db.usage.size).toBe(1)
    })
})

describe('hosted billing two-bucket spend', () => {
    it('draws included credit before purchased credit and records the split', async () => {
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
            amountCents: 5,
            idempotencyKey: 'included_grant',
            now: new Date(1),
        })
        await creditHostedBalance({
            env,
            workspaceId: 'workspace_1',
            source: 'stripe_topup',
            amountCents: 20,
            idempotencyKey: 'topup',
            now: new Date(2),
        })
        expect(db.accounts.get('workspace_1')?.includedBalanceCents).toBe(5)
        expect(db.accounts.get('workspace_1')?.purchasedBalanceCents).toBe(20)

        db.usage.set('usage_split', {
            id: 'usage_split',
            workspaceId: 'workspace_1',
            roomId: null,
            kind: 'provider',
            provider: 'openrouter',
            model: null,
            costMicros: null,
            billingStatus: 'pending',
            billingLedgerEntryId: null,
            idempotencyKey: null,
            createdAt: new Date(2).toISOString(),
        })

        const entry = await debitHostedBalance({
            env,
            workspaceId: 'workspace_1',
            source: 'hosted_openrouter_usage',
            amountCents: 8,
            usageEventId: 'usage_split',
            idempotencyKey: 'usage_split_key',
            now: new Date(3),
        })
        const account = db.accounts.get('workspace_1')!
        expect(account.includedBalanceCents).toBe(0)
        expect(account.purchasedBalanceCents).toBe(17)
        expect(entry.balanceAfterCents).toBe(17)
        expect(entry.metadata).toMatchObject({
            includedDebitedCents: 5,
            purchasedDebitedCents: 3,
        })
    })
})

describe('hosted billing reservations', () => {
    it('reserves only available balance and releases expired holds', async () => {
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
            idempotencyKey: 'included_grant',
            now: new Date(1),
        })

        const reservation = await authorizeHostedBillingReservation({
            env,
            workspaceId: 'workspace_1',
            roomId: 'room_1',
            provider: 'openrouter',
            amountCents: 40,
            idempotencyKey: 'reservation_1',
            metadata: {
                targetPath: '/chat/completions',
            },
            expiresAt: new Date(5),
            now: new Date(2),
        })
        let account = await readHostedBillingAccount({
            env,
            workspaceId: 'workspace_1',
        })
        expect(reservation.status).toBe('authorized')
        expect(account.currentBalanceCents).toBe(100)
        expect(account.reservedBalanceCents).toBe(40)
        expect(account.availableBalanceCents).toBe(60)

        await expect(
            authorizeHostedBillingReservation({
                env,
                workspaceId: 'workspace_1',
                roomId: 'room_1',
                provider: 'openrouter',
                amountCents: 70,
                idempotencyKey: 'reservation_too_large',
                expiresAt: new Date(10),
                now: new Date(3),
            }),
        ).rejects.toThrow('Hosted billing balance is exhausted')

        const released = await releaseExpiredHostedBillingReservations({
            env,
            workspaceId: 'workspace_1',
            now: new Date(6),
        })
        account = await readHostedBillingAccount({
            env,
            workspaceId: 'workspace_1',
        })
        expect(released).toBe(1)
        expect(db.reservations.get(reservation.id)?.status).toBe('expired')
        expect(account.reservedBalanceCents).toBe(0)
        expect(account.availableBalanceCents).toBe(100)
    })

    it('releases expired holds before the provider pre-send balance gate', async () => {
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
            amountCents: 1,
            idempotencyKey: 'included_gate',
            now: new Date(1),
        })
        const reservation = await authorizeHostedBillingReservation({
            env,
            workspaceId: 'workspace_1',
            roomId: 'room_1',
            provider: 'openrouter',
            amountCents: 1,
            idempotencyKey: 'expired_gate_reservation',
            expiresAt: new Date(5),
            now: new Date(2),
        })

        await expect(
            assertHostedProviderCreditsAvailable({
                env,
                workspaceId: 'workspace_1',
                now: new Date(3),
            }),
        ).rejects.toThrow('Hosted billing balance is exhausted')

        await expect(
            assertHostedProviderCreditsAvailable({
                env,
                workspaceId: 'workspace_1',
                now: new Date(6),
            }),
        ).resolves.toBeUndefined()

        const account = await readHostedBillingAccount({
            env,
            workspaceId: 'workspace_1',
        })
        expect(db.reservations.get(reservation.id)?.status).toBe('expired')
        expect(account.availableBalanceCents).toBe(1)
        expect(account.reservedBalanceCents).toBe(0)
    })
})

describe('hosted billing debit two-bucket split', () => {
    it('includedDebitedCents + purchasedDebitedCents equals amountCents with correct bucket assignment', async () => {
        const db = new FakeD1()
        const env = hostedEnv(db)
        await ensureHostedBillingAccount({ env, workspaceId: 'ws', now: new Date(0) })
        await creditHostedBalance({
            env,
            workspaceId: 'ws',
            source: 'subscription_included_credit',
            amountCents: 5,
            idempotencyKey: 'inc',
            now: new Date(1),
        })
        await creditHostedBalance({
            env,
            workspaceId: 'ws',
            source: 'stripe_topup',
            amountCents: 20,
            idempotencyKey: 'top',
            now: new Date(2),
        })

        db.usage.set('u_split', {
            id: 'u_split',
            workspaceId: 'ws',
            roomId: null,
            kind: 'provider',
            provider: 'openrouter',
            model: null,
            costMicros: null,
            billingStatus: 'pending',
            billingLedgerEntryId: null,
            idempotencyKey: null,
            createdAt: new Date(2).toISOString(),
        })

        const entry = await debitHostedBalance({
            env,
            workspaceId: 'ws',
            source: 'hosted_openrouter_usage',
            amountCents: 8,
            usageEventId: 'u_split',
            idempotencyKey: 'debit_split',
            now: new Date(3),
        })
        const meta = entry.metadata as {
            includedDebitedCents: number
            purchasedDebitedCents: number
        }
        expect(meta.includedDebitedCents + meta.purchasedDebitedCents).toBe(8)
        expect(meta.includedDebitedCents).toBe(5)
        expect(meta.purchasedDebitedCents).toBe(3)
        expect(db.accounts.get('ws')?.includedBalanceCents).toBe(0)
        expect(db.accounts.get('ws')?.purchasedBalanceCents).toBe(17)
    })

    it('purchasedDebitedCents is zero when the debit fits entirely within included balance', async () => {
        const db = new FakeD1()
        const env = hostedEnv(db)
        await ensureHostedBillingAccount({ env, workspaceId: 'ws', now: new Date(0) })
        await creditHostedBalance({
            env,
            workspaceId: 'ws',
            source: 'subscription_included_credit',
            amountCents: 10,
            idempotencyKey: 'inc',
            now: new Date(1),
        })

        db.usage.set('u_inc_only', {
            id: 'u_inc_only',
            workspaceId: 'ws',
            roomId: null,
            kind: 'provider',
            provider: 'openrouter',
            model: null,
            costMicros: null,
            billingStatus: 'pending',
            billingLedgerEntryId: null,
            idempotencyKey: null,
            createdAt: new Date(1).toISOString(),
        })

        const entry = await debitHostedBalance({
            env,
            workspaceId: 'ws',
            source: 'hosted_openrouter_usage',
            amountCents: 4,
            usageEventId: 'u_inc_only',
            idempotencyKey: 'debit_inc_only',
            now: new Date(2),
        })
        const meta = entry.metadata as {
            includedDebitedCents: number
            purchasedDebitedCents: number
        }
        expect(meta.includedDebitedCents).toBe(4)
        expect(meta.purchasedDebitedCents).toBe(0)
        expect(meta.includedDebitedCents + meta.purchasedDebitedCents).toBe(4)
        expect(db.accounts.get('ws')?.includedBalanceCents).toBe(6)
        expect(db.accounts.get('ws')?.purchasedBalanceCents).toBe(0)
    })
})
