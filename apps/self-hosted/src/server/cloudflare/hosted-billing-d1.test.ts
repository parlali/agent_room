import { readdirSync, readFileSync } from 'node:fs'
import { createClient, type Client, type InValue } from '@libsql/client'
import { describe, expect, it } from 'vitest'
import type { D1Database, R2Bucket } from '@cloudflare/workers-types'
import type { AgentRoomHostedEnv } from './bindings'
import {
    authorizeHostedBillingReservation,
    creditHostedBalance,
    ensureHostedBillingAccount,
} from './hosted-billing-repository'
import { recordHostedProviderUsage } from './hosted-usage-billing'

class LibsqlD1Statement {
    constructor(
        private readonly client: Client,
        private readonly sql: string,
        private readonly args: InValue[],
    ) {}

    async first<T>(): Promise<T | null> {
        const result = await this.client.execute({
            sql: this.sql,
            args: this.args,
        })
        return (result.rows[0] as T | undefined) ?? null
    }

    async all<T>(): Promise<{ results: T[] }> {
        const result = await this.client.execute({
            sql: this.sql,
            args: this.args,
        })
        return {
            results: result.rows as T[],
        }
    }

    async run() {
        const result = await this.client.execute({
            sql: this.sql,
            args: this.args,
        })
        return {
            success: true,
            meta: {
                changes: Number(result.rowsAffected ?? 0),
            },
            results: [],
        }
    }
}

class LibsqlD1 {
    constructor(private readonly client: Client) {}

    prepare(sql: string) {
        return {
            bind: (...args: InValue[]) => new LibsqlD1Statement(this.client, sql, args),
        }
    }

    async batch(statements: LibsqlD1Statement[]) {
        await this.client.execute('BEGIN')
        try {
            const results = []
            for (const statement of statements) {
                results.push(await statement.run())
            }
            await this.client.execute('COMMIT')
            return results
        } catch (error) {
            await this.client.execute('ROLLBACK')
            throw error
        }
    }
}

function readHostedMigration(): string {
    const migrationsUrl = new URL('../../../db/d1-migrations/', import.meta.url)
    return readdirSync(migrationsUrl)
        .filter((fileName) => fileName.endsWith('.sql'))
        .sort()
        .map((fileName) => readFileSync(new URL(fileName, migrationsUrl), 'utf8'))
        .join('\n')
}

async function createHostedDb(): Promise<LibsqlD1> {
    const client = createClient({ url: 'file::memory:' })
    await client.executeMultiple(readHostedMigration())
    const now = new Date(0).toISOString()
    await client.execute({
        sql: `
            INSERT INTO "user" (
                id,
                name,
                email,
                emailVerified,
                image,
                createdAt,
                updatedAt
            )
            VALUES ('user_1', 'user_1', 'user_1@example.test', 1, NULL, ?1, ?1)
        `,
        args: [now],
    })
    await client.execute({
        sql: `
            INSERT INTO organization (
                id,
                name,
                slug,
                logo,
                createdAt,
                metadata
            )
            VALUES ('workspace_1', 'workspace_1', 'workspace_1', NULL, ?1, '{}')
        `,
        args: [now],
    })
    await client.execute({
        sql: `
            INSERT INTO member (
                id,
                organizationId,
                userId,
                role,
                createdAt
            )
            VALUES ('member_1', 'workspace_1', 'user_1', 'owner', ?1)
        `,
        args: [now],
    })
    await client.execute({
        sql: `
            INSERT INTO hosted_room (
                id,
                workspace_id,
                slug,
                display_name,
                status,
                desired_state,
                created_by_user_id,
                created_at,
                updated_at
            )
            VALUES ('room_1', 'workspace_1', 'room_1', 'room_1', 'stopped', 'stopped', 'user_1', ?1, ?1)
        `,
        args: [now],
    })
    return new LibsqlD1(client)
}

function hostedEnv(db: LibsqlD1): AgentRoomHostedEnv {
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
        AGENT_ROOM_HOSTED_OPENROUTER_API_KEY: 'openrouter-test-key',
        AGENT_ROOM_EMAIL_WEBHOOK_URL: 'https://mail.example.test/send',
        AGENT_ROOM_EMAIL_WEBHOOK_BEARER_TOKEN: 'b'.repeat(16),
        AGENT_ROOM_EMAIL_FROM: 'Agent Room <noreply@example.test>',
    }
}

describe('hosted billing real D1 persistence', () => {
    it('debits usage and settles the active reservation in one repository batch', async () => {
        const db = await createHostedDb()
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
            idempotencyKey: 'reservation_1',
            expiresAt: new Date(60_000),
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
            model: 'openrouter/auto',
            inputTokens: null,
            outputTokens: null,
            cachedTokens: null,
            estimatedCostUsd: 0.1,
            costMicros: 100000,
            billingReservationId: reservation.id,
            idempotencyKey: 'usage_1',
            metadata: {
                billedBy: 'hosted_openrouter_proxy',
            },
            now: new Date(3),
        })

        const account = await db
            .prepare(
                `
                    SELECT
                        included_balance_cents AS includedBalanceCents,
                        included_reserved_cents AS includedReservedCents
                    FROM hosted_billing_account
                    WHERE workspace_id = ?1
                `,
            )
            .bind('workspace_1')
            .first<{ includedBalanceCents: number; includedReservedCents: number }>()
        const persistedReservation = await db
            .prepare(
                `
                    SELECT
                        status,
                        settled_cents AS settledCents,
                        usage_event_id AS usageEventId,
                        billing_ledger_entry_id AS billingLedgerEntryId
                    FROM hosted_billing_reservation
                    WHERE id = ?1
                `,
            )
            .bind(reservation.id)
            .first<{
                status: string
                settledCents: number
                usageEventId: string
                billingLedgerEntryId: string
            }>()

        expect(result.debitedCents).toBe(13)
        expect(account).toMatchObject({
            includedBalanceCents: 87,
            includedReservedCents: 0,
        })
        expect(persistedReservation).toMatchObject({
            status: 'settled',
            settledCents: 1,
            usageEventId: result.usageEventId,
            billingLedgerEntryId: result.ledgerEntryId,
        })
    })
})
