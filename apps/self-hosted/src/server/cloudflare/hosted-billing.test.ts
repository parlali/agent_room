import type { D1Database, R2Bucket } from '@cloudflare/workers-types'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AgentRoomHostedEnv } from './bindings'
import {
    creditHostedBalance,
    debitHostedBalance,
    ensureHostedBillingAccount,
    expireIncludedBalance,
} from './hosted-billing-repository'
import { centsFromMicrosCeil } from './hosted-billing-types'
import { recordHostedProviderUsage } from './hosted-usage-billing'
import {
    createHostedStripeCheckout,
    processHostedStripeWebhook,
    readHostedBillingSummary,
    verifyStripeWebhookPayload,
} from './hosted-stripe'

interface AccountRow {
    workspaceId: string
    stripeCustomerId: string | null
    stripeSubscriptionId: string | null
    planKey: string
    planStatus: string
    includedBalanceCents: number
    purchasedBalanceCents: number
    includedMonthlyCreditCents: number
    createdAt: string
    updatedAt: string
}

interface LedgerRow {
    id: string
    workspaceId: string
    direction: 'credit' | 'debit'
    source: string
    amountCents: number
    balanceAfterCents: number
    stripeEventId: string | null
    stripeCheckoutSessionId: string | null
    stripeInvoiceId: string | null
    usageEventId: string | null
    idempotencyKey: string
    metadata: string
    createdAt: string
}

interface UsageRow {
    id: string
    workspaceId: string
    roomId: string | null
    provider: string | null
    model: string | null
    costMicros: number | null
    billingStatus: string
    billingLedgerEntryId: string | null
    createdAt: string
}

function totalBalance(account: AccountRow): number {
    return account.includedBalanceCents + account.purchasedBalanceCents
}

class FakeD1 {
    accounts = new Map<string, AccountRow>()
    ledger = new Map<string, LedgerRow>()
    usage = new Map<string, UsageRow>()
    stripeEvents = new Set<string>()

    prepare(sql: string) {
        return {
            bind: (...args: unknown[]) => this.statement(sql, args),
        }
    }

    private statement(sql: string, args: unknown[]) {
        return {
            first: async <T>() => this.first<T>(sql, args),
            all: async <T>() => ({ results: this.all<T>(sql, args) }),
            run: async () => this.run(sql, args),
        }
    }

    private async first<T>(sql: string, args: unknown[]): Promise<T | null> {
        if (sql.includes('FROM hosted_stripe_event')) {
            const eventId = String(args[0])
            return (this.stripeEvents.has(eventId) ? { present: 1 } : null) as T | null
        }
        if (sql.includes('stripe_subscription_id =')) {
            const subscriptionId = args[0] as string | null
            const customerId = args[1] as string | null
            return (Array.from(this.accounts.values()).find(
                (account) =>
                    (subscriptionId && account.stripeSubscriptionId === subscriptionId) ||
                    (customerId && account.stripeCustomerId === customerId),
            ) ?? null) as T | null
        }
        if (sql.includes('FROM hosted_billing_ledger_entry')) {
            const workspaceId = String(args[0])
            const idempotencyKey = String(args[1])
            return (Array.from(this.ledger.values()).find(
                (entry) =>
                    entry.workspaceId === workspaceId && entry.idempotencyKey === idempotencyKey,
            ) ?? null) as T | null
        }
        if (sql.includes('FROM hosted_billing_account')) {
            return (this.accounts.get(String(args[0])) ?? null) as T | null
        }
        if (sql.includes('UPDATE hosted_billing_account') && sql.includes('RETURNING')) {
            const workspaceId = String(args[0])
            const account = this.accounts.get(workspaceId)
            if (!account) return null
            if (sql.includes('included_balance_cents = 0')) {
                const clearedCents = Number(args[1])
                if (account.includedBalanceCents !== clearedCents) return null
                account.includedBalanceCents = 0
                account.updatedAt = String(args[2])
                return { currentBalanceCents: totalBalance(account) } as T
            }
            if (
                sql.includes('included_balance_cents = included_balance_cents - ?2') &&
                sql.includes('AND included_balance_cents = ?5') &&
                sql.includes('AND purchased_balance_cents = ?6')
            ) {
                const includedDrawn = Number(args[1])
                const purchasedDrawn = Number(args[2])
                const now = String(args[3])
                const expectedIncluded = Number(args[4])
                const expectedPurchased = Number(args[5])
                if (
                    account.includedBalanceCents !== expectedIncluded ||
                    account.purchasedBalanceCents !== expectedPurchased
                ) {
                    return null
                }
                account.includedBalanceCents -= includedDrawn
                account.purchasedBalanceCents -= purchasedDrawn
                account.updatedAt = now
                return { currentBalanceCents: totalBalance(account) } as T
            }
            const amount = Number(args[1])
            if (sql.includes('included_balance_cents = included_balance_cents + ?2')) {
                account.includedBalanceCents += amount
            } else if (sql.includes('purchased_balance_cents = purchased_balance_cents + ?2')) {
                account.purchasedBalanceCents += amount
            }
            account.updatedAt = String(args[2])
            return { currentBalanceCents: totalBalance(account) } as T
        }
        return null
    }

    private all<T>(sql: string, args: unknown[]): T[] {
        if (sql.includes('FROM hosted_billing_ledger_entry')) {
            return Array.from(this.ledger.values())
                .filter((entry) => entry.workspaceId === String(args[0]))
                .slice(0, Number(args[1])) as T[]
        }
        if (sql.includes('FROM hosted_usage_event')) {
            return Array.from(this.usage.values())
                .filter((entry) => entry.workspaceId === String(args[0]))
                .slice(0, Number(args[1])) as T[]
        }
        return []
    }

    private async run(sql: string, args: unknown[]) {
        let changes = 0
        if (sql.includes('INSERT INTO hosted_billing_account')) {
            const workspaceId = String(args[0])
            if (!this.accounts.has(workspaceId)) {
                this.accounts.set(workspaceId, {
                    workspaceId,
                    stripeCustomerId: null,
                    stripeSubscriptionId: null,
                    planKey: 'none',
                    planStatus: 'none',
                    includedBalanceCents: 0,
                    purchasedBalanceCents: 0,
                    includedMonthlyCreditCents: 0,
                    createdAt: String(args[1]),
                    updatedAt: String(args[1]),
                })
                changes = 1
            }
        }
        if (sql.includes('INSERT INTO hosted_billing_ledger_entry')) {
            const entry = this.parseLedgerInsert(sql, args)
            this.ledger.set(entry.id, entry)
            changes = 1
        }
        if (sql.includes('INSERT INTO hosted_usage_event')) {
            this.usage.set(String(args[0]), {
                id: String(args[0]),
                workspaceId: String(args[1]),
                roomId: (args[2] as string | null) ?? null,
                provider: (args[7] as string | null) ?? null,
                model: (args[8] as string | null) ?? null,
                costMicros: (args[13] as number | null) ?? null,
                billingStatus: String(args[14]),
                billingLedgerEntryId: null,
                createdAt: String(args[15]),
            })
            changes = 1
        }
        if (sql.includes('INSERT OR IGNORE INTO hosted_stripe_event')) {
            const eventId = String(args[0])
            if (!this.stripeEvents.has(eventId)) {
                this.stripeEvents.add(eventId)
                changes = 1
            }
        }
        if (sql.includes('UPDATE hosted_billing_account') && !sql.includes('RETURNING')) {
            if (sql.includes('SET stripe_customer_id')) {
                const account = this.accounts.get(String(args[0]))
                if (account) {
                    account.stripeCustomerId = String(args[1])
                    const subscriptionId = args[2] as string | null
                    if (subscriptionId !== null) account.stripeSubscriptionId = subscriptionId
                    const planStatus = args[3] as string | null
                    if (planStatus !== null) account.planStatus = planStatus
                    const planKey = args[4] as string | null
                    if (planKey !== null) account.planKey = planKey
                    const includedMonthlyCreditCents = args[5] as number | null
                    if (includedMonthlyCreditCents !== null) {
                        account.includedMonthlyCreditCents = includedMonthlyCreditCents
                    }
                    account.updatedAt = String(args[6])
                    changes = 1
                }
            }
        }
        if (sql.includes("SET billing_status = 'debited'")) {
            const usage = this.usage.get(String(args[1]))
            if (usage?.workspaceId === String(args[0]) && usage.billingStatus === 'pending') {
                usage.billingStatus = 'debited'
                usage.billingLedgerEntryId = String(args[2])
                changes = 1
            }
        }
        if (sql.includes("SET billing_status = 'blocked'")) {
            const usage = this.usage.get(String(args[1]))
            if (usage?.workspaceId === String(args[0]) && usage.billingStatus === 'pending') {
                usage.billingStatus = 'blocked'
                changes = 1
            }
        }
        return {
            success: true,
            meta: {
                changes,
            },
            results: [],
        }
    }

    private parseLedgerInsert(sql: string, args: unknown[]): LedgerRow {
        const base = {
            id: String(args[0]),
            workspaceId: String(args[1]),
        }
        if (sql.includes("'included_credit_expiry'")) {
            return {
                ...base,
                direction: 'debit',
                source: 'included_credit_expiry',
                amountCents: Number(args[2]),
                balanceAfterCents: Number(args[3]),
                stripeEventId: (args[4] as string | null) ?? null,
                stripeCheckoutSessionId: null,
                stripeInvoiceId: (args[5] as string | null) ?? null,
                usageEventId: null,
                idempotencyKey: String(args[6]),
                metadata: String(args[7]),
                createdAt: String(args[8]),
            }
        }
        if (sql.includes("'credit'")) {
            return {
                ...base,
                direction: 'credit',
                source: String(args[2]),
                amountCents: Number(args[3]),
                balanceAfterCents: Number(args[4]),
                stripeEventId: (args[5] as string | null) ?? null,
                stripeCheckoutSessionId: (args[6] as string | null) ?? null,
                stripeInvoiceId: (args[7] as string | null) ?? null,
                usageEventId: null,
                idempotencyKey: String(args[8]),
                metadata: String(args[9]),
                createdAt: String(args[10]),
            }
        }
        return {
            ...base,
            direction: 'debit',
            source: String(args[2]),
            amountCents: Number(args[3]),
            balanceAfterCents: Number(args[4]),
            stripeEventId: null,
            stripeCheckoutSessionId: null,
            stripeInvoiceId: null,
            usageEventId: String(args[5]),
            idempotencyKey: String(args[6]),
            metadata: String(args[7]),
            createdAt: String(args[8]),
        }
    }
}

function hostedEnv(db = new FakeD1()): AgentRoomHostedEnv {
    return {
        AGENT_ROOM_DB: db as unknown as D1Database,
        AGENT_ROOM_WORKSPACE_BUCKET: {} as R2Bucket,
        AGENT_ROOM_RUNTIME_JOBS: {} as AgentRoomHostedEnv['AGENT_ROOM_RUNTIME_JOBS'],
        AGENT_ROOM_RUNTIME: {} as AgentRoomHostedEnv['AGENT_ROOM_RUNTIME'],
        AGENT_ROOM_AUTH_MODE: 'better-auth',
        AGENT_ROOM_BILLING_MODE: 'disabled',
        AGENT_ROOM_BILLING_PLANS: '[]',
        AGENT_ROOM_BILLING_USAGE_MARKUP_BPS: '13000',
        AGENT_ROOM_BILLING_TAX_MODE: 'automatic',
        AGENT_ROOM_BILLING_MAX_CONCURRENT_ROOMS: '3',
        AGENT_ROOM_RUNTIME_BACKEND: 'cloudflare-containers',
        AGENT_ROOM_RUNTIME_STORAGE: 'r2',
        BETTER_AUTH_SECRET: 'a'.repeat(32),
        BETTER_AUTH_URL: 'https://rooms.example.test',
        AGENT_ROOM_EMAIL_WEBHOOK_URL: 'https://mail.example.test/send',
        AGENT_ROOM_EMAIL_WEBHOOK_BEARER_TOKEN: 'b'.repeat(16),
        AGENT_ROOM_EMAIL_FROM: 'Agent Room <noreply@example.test>',
    }
}

const stripePlansJson =
    '[{"key":"starter","priceId":"price_starter_placeholder","monthlyCents":700,"includedCents":0},{"key":"standard","priceId":"price_standard_placeholder","monthlyCents":2000,"includedCents":1200},{"key":"pro","priceId":"price_pro_placeholder","monthlyCents":5000,"includedCents":3500}]'

function stripeHostedEnv(db = new FakeD1()): AgentRoomHostedEnv {
    return {
        ...hostedEnv(db),
        AGENT_ROOM_BILLING_MODE: 'stripe',
        AGENT_ROOM_BILLING_PLANS: stripePlansJson,
        STRIPE_SECRET_KEY: 'stripe-secret-test-value',
        STRIPE_WEBHOOK_SECRET: 'stripe-webhook-test-value',
        STRIPE_CREDIT_TOPUP_PRICE_ID: 'price_topup_placeholder',
    }
}

async function stripeSignature(input: { secret: string; body: string; timestamp: number }) {
    const encoder = new TextEncoder()
    const key = await crypto.subtle.importKey(
        'raw',
        encoder.encode(input.secret),
        {
            name: 'HMAC',
            hash: 'SHA-256',
        },
        false,
        ['sign'],
    )
    const signature = await crypto.subtle.sign(
        'HMAC',
        key,
        encoder.encode(`${input.timestamp}.${input.body}`),
    )
    return Array.from(new Uint8Array(signature))
        .map((byte) => byte.toString(16).padStart(2, '0'))
        .join('')
}

async function deliverStripeEvent(input: {
    env: AgentRoomHostedEnv
    secret: string
    event: unknown
    timestamp?: number
}) {
    const body = JSON.stringify(input.event)
    const timestamp = input.timestamp ?? 1000
    const signature = await stripeSignature({
        secret: input.secret,
        body,
        timestamp,
    })
    const originalNow = Date.now
    vi.spyOn(Date, 'now').mockReturnValue(timestamp * 1000)
    try {
        return await processHostedStripeWebhook({
            env: input.env,
            body,
            signatureHeader: `t=${timestamp},v1=${signature}`,
        })
    } finally {
        Date.now = originalNow
    }
}

afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
})

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

        await expect(
            debitHostedBalance({
                env,
                workspaceId: 'workspace_1',
                source: 'hosted_openrouter_usage',
                amountCents: 24,
                usageEventId: usageEventId.usageEventId,
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
            provider: 'openrouter',
            model: null,
            costMicros: null,
            billingStatus: 'pending',
            billingLedgerEntryId: null,
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
})

describe('hosted billing service API', () => {
    it('returns summary actions and creates checkout sessions with workspace metadata', async () => {
        const db = new FakeD1()
        const env = stripeHostedEnv(db)
        const actor = {
            authProvider: 'better-auth' as const,
            userId: 'user_1',
            email: 'user@example.test',
            workspaceId: 'workspace_1',
            workspaceRole: 'owner' as const,
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
        expect(summary.providerPriority).toEqual(['codex', 'user_key', 'hosted_openrouter'])

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
        expect(String(init?.body)).toContain('line_items%5B0%5D%5Bprice%5D=price_topup_placeholder')
        expect(String(init?.body)).toContain('automatic_tax%5Benabled%5D=true')

        await createHostedStripeCheckout({
            env,
            actor,
            kind: 'subscription',
            planKey: 'standard',
        })
        const [, subscriptionInit] = fetchMock.mock.calls[1] ?? []
        expect(String(subscriptionInit?.body)).toContain(
            'line_items%5B0%5D%5Bprice%5D=price_standard_placeholder',
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
            email: 'user@example.test',
            workspaceId: 'workspace_1',
            workspaceRole: 'owner' as const,
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
                                    id: 'price_standard_placeholder',
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
                        data: [{ price: { id: 'price_standard_placeholder' } }],
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
            provider: 'openrouter',
            model: null,
            costMicros: null,
            billingStatus: 'pending',
            billingLedgerEntryId: null,
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
            provider: 'openrouter',
            model: null,
            costMicros: null,
            billingStatus: 'pending',
            billingLedgerEntryId: null,
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
