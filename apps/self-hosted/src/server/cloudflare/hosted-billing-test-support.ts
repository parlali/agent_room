import type { D1Database, R2Bucket } from '@cloudflare/workers-types'
import type { AgentRoomHostedEnv } from './bindings'
import { processHostedStripeWebhook } from './hosted-stripe'

export interface AccountRow {
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

export interface LedgerRow {
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

export interface UsageRow {
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

export interface ReservationRow {
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

export function totalBalance(account: AccountRow): number {
    return account.includedBalanceCents + account.purchasedBalanceCents
}

export class FakeD1 {
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
            if (sql.includes('included_balance_cents = included_reserved_cents')) {
                const account = this.accounts.get(String(args[0]))
                if (
                    account &&
                    account.includedBalanceCents === Number(args[1]) &&
                    account.includedReservedCents === Number(args[3])
                ) {
                    account.includedBalanceCents = account.includedReservedCents
                    account.updatedAt = String(args[2])
                    changes = 1
                }
            } else if (
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
                sql.includes('included_balance_cents = included_balance_cents - ?2') &&
                sql.includes('purchased_balance_cents = purchased_balance_cents - ?3') &&
                sql.includes('included_reserved_cents = included_reserved_cents - ?4') &&
                sql.includes('purchased_reserved_cents = purchased_reserved_cents - ?5')
            ) {
                const account = this.accounts.get(String(args[0]))
                const ledgerId = String(args[10])
                if (
                    account &&
                    this.ledger.has(ledgerId) &&
                    account.includedBalanceCents === Number(args[6]) &&
                    account.purchasedBalanceCents === Number(args[7]) &&
                    account.includedReservedCents === Number(args[8]) &&
                    account.purchasedReservedCents === Number(args[9]) &&
                    account.includedReservedCents >= Number(args[3]) &&
                    account.purchasedReservedCents >= Number(args[4])
                ) {
                    account.includedBalanceCents -= Number(args[1])
                    account.purchasedBalanceCents -= Number(args[2])
                    account.includedReservedCents -= Number(args[3])
                    account.purchasedReservedCents -= Number(args[4])
                    account.updatedAt = String(args[5])
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
                if (sql.includes("SET status = 'settled'")) {
                    reservation.status = 'settled'
                    reservation.settledCents = Number(args[2])
                    reservation.usageEventId = (args[3] as string | null) ?? null
                    reservation.billingLedgerEntryId = (args[4] as string | null) ?? null
                    reservation.updatedAt = String(args[5])
                    changes = 1
                } else {
                    reservation.status = args[2] as ReservationRow['status']
                    reservation.settledCents = Number(args[3])
                    reservation.usageEventId = (args[4] as string | null) ?? null
                    reservation.billingLedgerEntryId = (args[5] as string | null) ?? null
                    reservation.updatedAt = String(args[6])
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

export function hostedEnv(db = new FakeD1()): AgentRoomHostedEnv {
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

export function stripeHostedEnv(db = new FakeD1()): AgentRoomHostedEnv {
    return {
        ...hostedEnv(db),
        AGENT_ROOM_BILLING_MODE: 'stripe',
        AGENT_ROOM_BILLING_PLANS: stripePlansJson,
        STRIPE_SECRET_KEY: 'stripe-secret-test-value',
        STRIPE_WEBHOOK_SECRET: 'stripe-webhook-test-value',
        STRIPE_CREDIT_TOPUP_PRICE_ID: 'price_test_topup_000000',
    }
}

export async function stripeSignature(input: { secret: string; body: string; timestamp: number }) {
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

export async function deliverStripeEvent(input: {
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
    Date.now = () => timestamp * 1000
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
