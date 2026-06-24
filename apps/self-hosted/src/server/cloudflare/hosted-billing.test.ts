import type { D1Database, R2Bucket } from '@cloudflare/workers-types'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AgentRoomHostedEnv } from './bindings'
import {
    appendHostedUsageEvent,
    authorizeHostedBillingReservation,
    creditHostedBalance,
    debitHostedBalance,
    ensureHostedBillingAccount,
    expireIncludedBalance,
    readHostedBillingAccount,
    readHostedProviderUsageSettlementByIdempotencyKey,
    releaseExpiredHostedBillingReservations,
} from './hosted-billing-repository'
import { centsFromMicrosCeil } from './hosted-billing-types'
import {
    assertHostedProviderCreditsAvailable,
    recordHostedProviderUsage,
    recordHostedRuntimeUsageEvent,
} from './hosted-usage-billing'
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
    includedReservedCents: number
    purchasedReservedCents: number
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
    kind: string
    provider: string | null
    model: string | null
    costMicros: number | null
    billingStatus: string
    billingLedgerEntryId: string | null
    idempotencyKey: string | null
    metadata?: string
    createdAt: string
}

interface ReservationRow {
    id: string
    workspaceId: string
    roomId: string | null
    sessionKey: string | null
    runId: string | null
    jobId: string | null
    provider: 'openrouter' | 'brave'
    status: 'authorized' | 'settled' | 'released' | 'expired'
    reservedCents: number
    includedReservedCents: number
    purchasedReservedCents: number
    settledCents: number
    usageEventId: string | null
    billingLedgerEntryId: string | null
    idempotencyKey: string
    metadata: string
    expiresAt: string
    createdAt: string
    updatedAt: string
}

function totalBalance(account: AccountRow): number {
    return account.includedBalanceCents + account.purchasedBalanceCents
}

class FakeD1 {
    accounts = new Map<string, AccountRow>()
    ledger = new Map<string, LedgerRow>()
    usage = new Map<string, UsageRow>()
    reservations = new Map<string, ReservationRow>()
    stripeEvents = new Set<string>()

    prepare(sql: string) {
        return {
            bind: (...args: unknown[]) => this.statement(sql, args),
        }
    }

    async batch(statements: Array<{ run: () => Promise<unknown> }>) {
        const results = []
        for (const statement of statements) {
            results.push(await statement.run())
        }
        return results
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
        if (sql.includes('FROM hosted_usage_event') && sql.includes('idempotency_key')) {
            const workspaceId = String(args[0])
            const idempotencyKey = String(args[1])
            const usage = Array.from(this.usage.values()).find(
                (entry) =>
                    entry.workspaceId === workspaceId && entry.idempotencyKey === idempotencyKey,
            )
            if (!usage) {
                return null
            }
            if (sql.includes('cost_micros AS costMicros')) {
                return {
                    id: usage.id,
                    roomId: usage.roomId,
                    sessionKey: null,
                    runId: null,
                    jobId: null,
                    provider: usage.provider,
                    model: usage.model,
                    costMicros: usage.costMicros,
                    billingStatus: usage.billingStatus,
                    billingLedgerEntryId: usage.billingLedgerEntryId,
                } as T
            }
            return { id: usage.id } as T
        }
        if (
            sql.includes('FROM hosted_billing_reservation') &&
            sql.includes('AND idempotency_key = ?2')
        ) {
            const workspaceId = String(args[0])
            const idempotencyKey = String(args[1])
            return (Array.from(this.reservations.values()).find(
                (reservation) =>
                    reservation.workspaceId === workspaceId &&
                    reservation.idempotencyKey === idempotencyKey,
            ) ?? null) as T | null
        }
        if (sql.includes('FROM hosted_billing_reservation') && sql.includes('AND id = ?2')) {
            const workspaceId = String(args[0])
            const id = String(args[1])
            const reservation = this.reservations.get(id)
            return (reservation?.workspaceId === workspaceId ? reservation : null) as T | null
        }
        if (
            sql.includes('FROM hosted_billing_reservation') &&
            sql.includes('ORDER BY created_at ASC')
        ) {
            const workspaceId = String(args[0])
            const roomId = (args[1] as string | null) ?? null
            const provider = String(args[2])
            const now = String(args[3])
            return (Array.from(this.reservations.values())
                .filter(
                    (reservation) =>
                        reservation.workspaceId === workspaceId &&
                        (roomId === null || reservation.roomId === roomId) &&
                        reservation.provider === provider &&
                        reservation.status === 'authorized' &&
                        reservation.expiresAt > now,
                )
                .sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0] ?? null) as T | null
        }
        if (
            sql.includes('FROM hosted_usage_event') &&
            sql.includes('billing_status AS billingStatus')
        ) {
            const workspaceId = String(args[0])
            const usageEventId = String(args[1])
            const usage = this.usage.get(usageEventId)
            return (
                usage?.workspaceId === workspaceId
                    ? {
                          billingStatus: usage.billingStatus,
                          billingLedgerEntryId: usage.billingLedgerEntryId,
                      }
                    : null
            ) as T | null
        }
        if (sql.includes('FROM hosted_billing_account')) {
            return (this.accounts.get(String(args[0])) ?? null) as T | null
        }
        if (sql.includes('UPDATE hosted_billing_account') && sql.includes('RETURNING')) {
            const workspaceId = String(args[0])
            const account = this.accounts.get(workspaceId)
            if (!account) return null
            if (sql.includes('included_balance_cents = included_reserved_cents')) {
                const expectedIncluded = Number(args[1])
                const expectedReserved = Number(args[3])
                if (
                    account.includedBalanceCents !== expectedIncluded ||
                    account.includedReservedCents !== expectedReserved
                ) {
                    return null
                }
                account.includedBalanceCents = account.includedReservedCents
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
        if (sql.includes('FROM hosted_billing_reservation') && sql.includes('expires_at <=')) {
            const scoped = sql.includes('workspace_id = ?1')
            const workspaceId = scoped ? String(args[0]) : null
            const now = String(scoped ? args[1] : args[0])
            return Array.from(this.reservations.values())
                .filter(
                    (reservation) =>
                        reservation.status === 'authorized' &&
                        reservation.expiresAt <= now &&
                        (!workspaceId || reservation.workspaceId === workspaceId),
                )
                .sort((a, b) => a.expiresAt.localeCompare(b.expiresAt)) as T[]
        }
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
                    includedReservedCents: 0,
                    purchasedReservedCents: 0,
                    includedMonthlyCreditCents: 0,
                    createdAt: String(args[1]),
                    updatedAt: String(args[1]),
                })
                changes = 1
            }
        }
        if (sql.includes('INSERT INTO hosted_billing_reservation')) {
            const workspaceId = String(args[1])
            const account = this.accounts.get(workspaceId)
            const existing = Array.from(this.reservations.values()).find(
                (reservation) =>
                    reservation.workspaceId === workspaceId &&
                    reservation.idempotencyKey === String(args[10]),
            )
            const reservedCents = Number(args[7])
            const expectedIncluded = Number(args[14])
            const expectedPurchased = Number(args[15])
            const expectedIncludedReserved = Number(args[16])
            const expectedPurchasedReserved = Number(args[17])
            if (
                account &&
                !existing &&
                account.includedBalanceCents === expectedIncluded &&
                account.purchasedBalanceCents === expectedPurchased &&
                account.includedReservedCents === expectedIncludedReserved &&
                account.purchasedReservedCents === expectedPurchasedReserved &&
                totalBalance(account) -
                    account.includedReservedCents -
                    account.purchasedReservedCents >=
                    reservedCents
            ) {
                this.reservations.set(String(args[0]), {
                    id: String(args[0]),
                    workspaceId,
                    roomId: (args[2] as string | null) ?? null,
                    sessionKey: (args[3] as string | null) ?? null,
                    runId: (args[4] as string | null) ?? null,
                    jobId: (args[5] as string | null) ?? null,
                    provider: args[6] as ReservationRow['provider'],
                    status: 'authorized',
                    reservedCents,
                    includedReservedCents: Number(args[8]),
                    purchasedReservedCents: Number(args[9]),
                    settledCents: 0,
                    usageEventId: null,
                    billingLedgerEntryId: null,
                    idempotencyKey: String(args[10]),
                    metadata: String(args[11]),
                    expiresAt: String(args[12]),
                    createdAt: String(args[13]),
                    updatedAt: String(args[13]),
                })
                changes = 1
            }
        }
        if (sql.includes('INSERT INTO hosted_billing_ledger_entry')) {
            const entry = this.parseLedgerInsert(sql, args)
            if (sql.includes('SELECT ?1') && sql.includes('NOT EXISTS')) {
                const account = this.accounts.get(entry.workspaceId)
                const creditInsert = sql.includes("'credit'")
                const expectedIncluded = Number(args[creditInsert ? 11 : 9])
                const expectedPurchased = Number(args[creditInsert ? 12 : 10])
                const expectedIncludedReserved = creditInsert ? 0 : Number(args[11])
                const expectedPurchasedReserved = creditInsert ? 0 : Number(args[12])
                const includedReservedDraw = creditInsert ? 0 : Number(args[13])
                const purchasedReservedDraw = creditInsert ? 0 : Number(args[14])
                const existing = Array.from(this.ledger.values()).find(
                    (candidate) =>
                        candidate.workspaceId === entry.workspaceId &&
                        candidate.idempotencyKey === entry.idempotencyKey,
                )
                const spendable =
                    account === undefined
                        ? 0
                        : totalBalance(account) -
                          account.includedReservedCents -
                          account.purchasedReservedCents +
                          includedReservedDraw +
                          purchasedReservedDraw
                if (
                    account &&
                    !existing &&
                    account.includedBalanceCents === expectedIncluded &&
                    account.purchasedBalanceCents === expectedPurchased &&
                    (creditInsert ||
                        (account.includedReservedCents === expectedIncludedReserved &&
                            account.purchasedReservedCents === expectedPurchasedReserved &&
                            spendable >= entry.amountCents))
                ) {
                    this.ledger.set(entry.id, entry)
                    changes = 1
                }
            } else {
                this.ledger.set(entry.id, entry)
                changes = 1
            }
        }
        if (sql.includes('INSERT') && sql.includes('INTO hosted_usage_event')) {
            const idempotencyKey = (args[22] as string | null) ?? null
            const existing = idempotencyKey
                ? Array.from(this.usage.values()).find(
                      (entry) =>
                          entry.workspaceId === String(args[1]) &&
                          entry.idempotencyKey === idempotencyKey,
                  )
                : null
            if (existing) {
                return {
                    success: true,
                    meta: {
                        changes: 0,
                    },
                    results: [],
                }
            }
            this.usage.set(String(args[0]), {
                id: String(args[0]),
                workspaceId: String(args[1]),
                roomId: (args[2] as string | null) ?? null,
                kind: String(args[6]),
                provider: (args[7] as string | null) ?? null,
                model: (args[8] as string | null) ?? null,
                costMicros: (args[19] as number | null) ?? null,
                billingStatus: String(args[20]),
                billingLedgerEntryId: null,
                idempotencyKey,
                metadata: String(args[21]),
                createdAt: String(args[23]),
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
            if (
                sql.includes('included_reserved_cents = included_reserved_cents + ?2') &&
                sql.includes('purchased_reserved_cents = purchased_reserved_cents + ?3')
            ) {
                const account = this.accounts.get(String(args[0]))
                const reservation = this.reservations.get(String(args[8]))
                if (
                    account &&
                    reservation?.workspaceId === String(args[0]) &&
                    account.includedBalanceCents === Number(args[4]) &&
                    account.purchasedBalanceCents === Number(args[5]) &&
                    account.includedReservedCents === Number(args[6]) &&
                    account.purchasedReservedCents === Number(args[7])
                ) {
                    account.includedReservedCents += Number(args[1])
                    account.purchasedReservedCents += Number(args[2])
                    account.updatedAt = String(args[3])
                    changes = 1
                }
            } else if (
                sql.includes('included_balance_cents = included_balance_cents + ?2') ||
                sql.includes('purchased_balance_cents = purchased_balance_cents + ?2')
            ) {
                const account = this.accounts.get(String(args[0]))
                const ledgerId = String(args[5])
                if (
                    account &&
                    this.ledger.has(ledgerId) &&
                    account.includedBalanceCents === Number(args[3]) &&
                    account.purchasedBalanceCents === Number(args[4])
                ) {
                    if (sql.includes('included_balance_cents = included_balance_cents + ?2')) {
                        account.includedBalanceCents += Number(args[1])
                    } else {
                        account.purchasedBalanceCents += Number(args[1])
                    }
                    account.updatedAt = String(args[2])
                    changes = 1
                }
            } else if (
                sql.includes('included_reserved_cents = included_reserved_cents - ?2') &&
                sql.includes('purchased_reserved_cents = purchased_reserved_cents - ?3')
            ) {
                const account = this.accounts.get(String(args[0]))
                if (
                    account &&
                    account.includedReservedCents >= Number(args[1]) &&
                    account.purchasedReservedCents >= Number(args[2])
                ) {
                    account.includedReservedCents -= Number(args[1])
                    account.purchasedReservedCents -= Number(args[2])
                    account.updatedAt = String(args[3])
                    changes = 1
                }
            } else if (
                sql.includes('included_balance_cents = included_balance_cents - ?2') &&
                sql.includes('purchased_balance_cents = purchased_balance_cents - ?3')
            ) {
                const account = this.accounts.get(String(args[0]))
                const ledgerId = String(args[8])
                if (
                    account &&
                    this.ledger.has(ledgerId) &&
                    account.includedBalanceCents === Number(args[4]) &&
                    account.purchasedBalanceCents === Number(args[5]) &&
                    account.includedReservedCents === Number(args[6]) &&
                    account.purchasedReservedCents === Number(args[7])
                ) {
                    account.includedBalanceCents -= Number(args[1])
                    account.purchasedBalanceCents -= Number(args[2])
                    account.updatedAt = String(args[3])
                    changes = 1
                }
            } else if (sql.includes('SET stripe_customer_id')) {
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
        if (sql.includes('UPDATE hosted_billing_reservation')) {
            const reservation = this.reservations.get(String(args[1]))
            if (
                reservation?.workspaceId === String(args[0]) &&
                reservation.status === 'authorized'
            ) {
                reservation.status = args[2] as ReservationRow['status']
                reservation.settledCents = Number(args[3])
                reservation.usageEventId = (args[4] as string | null) ?? null
                reservation.billingLedgerEntryId = (args[5] as string | null) ?? null
                reservation.updatedAt = String(args[6])
                changes = 1
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
        AGENT_ROOM_HOSTED_ENCRYPTION_KEY_B64: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
        AGENT_ROOM_EMAIL_WEBHOOK_URL: 'https://mail.example.test/send',
        AGENT_ROOM_EMAIL_WEBHOOK_BEARER_TOKEN: 'b'.repeat(16),
        AGENT_ROOM_EMAIL_FROM: 'Agent Room <noreply@example.test>',
        AGENT_ROOM_HOSTED_OPENROUTER_API_KEY: 'openrouter-platform-key',
    }
}

const stripePlansJson =
    '[{"key":"starter","priceId":"price_test_starter_000000","monthlyCents":700,"includedCents":0},{"key":"standard","priceId":"price_test_standard_000000","monthlyCents":2000,"includedCents":1200},{"key":"pro","priceId":"price_test_pro_000000","monthlyCents":5000,"includedCents":3500}]'

function stripeHostedEnv(db = new FakeD1()): AgentRoomHostedEnv {
    return {
        ...hostedEnv(db),
        AGENT_ROOM_BILLING_MODE: 'stripe',
        AGENT_ROOM_BILLING_PLANS: stripePlansJson,
        STRIPE_SECRET_KEY: 'stripe-secret-test-value',
        STRIPE_WEBHOOK_SECRET: 'stripe-webhook-test-value',
        STRIPE_CREDIT_TOPUP_PRICE_ID: 'price_test_topup_000000',
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
