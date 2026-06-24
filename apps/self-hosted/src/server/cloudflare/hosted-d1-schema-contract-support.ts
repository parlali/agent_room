import { readdirSync, readFileSync } from 'node:fs'
import { createClient, type Client } from '@libsql/client'
import { expect } from 'vitest'

export function readHostedMigration(): string {
    const migrationsUrl = new URL('../../../db/d1-migrations/', import.meta.url)
    return readdirSync(migrationsUrl)
        .filter((fileName) => fileName.endsWith('.sql'))
        .sort()
        .map((fileName) => readFileSync(new URL(fileName, migrationsUrl), 'utf8'))
        .join('\n')
}

export function readHostedMigrationFile(fileName: string): string {
    return readFileSync(new URL(`../../../db/d1-migrations/${fileName}`, import.meta.url), 'utf8')
}

export async function createHostedControlPlaneDb(): Promise<Client> {
    const db = createClient({ url: 'file::memory:' })
    await db.executeMultiple(readHostedMigrationFile('0001_hosted_control_plane.sql'))
    return db
}

export async function createHostedFullDb(): Promise<Client> {
    const db = createClient({ url: 'file::memory:' })
    await db.executeMultiple(readHostedMigration())
    return db
}

export async function insertHostedAuthRow(input: {
    db: Client
    userId: string
    organizationId: string
    memberId: string
    role?: string
}): Promise<void> {
    const now = new Date(0).toISOString()
    await input.db.execute({
        sql: `
            INSERT OR IGNORE INTO "user" (
                id,
                name,
                email,
                emailVerified,
                image,
                createdAt,
                updatedAt
            )
            VALUES (?1, ?2, ?3, 1, NULL, ?4, ?4)
        `,
        args: [input.userId, input.userId, `${input.userId}@example.test`, now],
    })
    await input.db.execute({
        sql: `
            INSERT OR IGNORE INTO organization (
                id,
                name,
                slug,
                logo,
                createdAt,
                metadata
            )
            VALUES (?1, ?2, ?3, NULL, ?4, '{}')
        `,
        args: [input.organizationId, input.organizationId, input.organizationId, now],
    })
    await input.db.execute({
        sql: `
            INSERT INTO member (
                id,
                organizationId,
                userId,
                role,
                createdAt
            )
            VALUES (?1, ?2, ?3, ?4, ?5)
        `,
        args: [input.memberId, input.organizationId, input.userId, input.role ?? 'owner', now],
    })
}

export async function insertHostedRoom(input: {
    db: Client
    workspaceId: string
    roomId: string
    userId: string
    now?: string
}): Promise<void> {
    const now = input.now ?? new Date(0).toISOString()
    await input.db.execute({
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
            VALUES (?1, ?2, ?3, ?3, 'stopped', 'stopped', ?4, ?5, ?5)
        `,
        args: [input.roomId, input.workspaceId, input.roomId, input.userId, now],
    })
}

export async function insertHostedRoomJob(input: {
    db: Client
    workspaceId: string
    roomId: string
    jobId: string
    now?: string
}): Promise<void> {
    const now = input.now ?? new Date(0).toISOString()
    await input.db.execute({
        sql: `
            INSERT INTO hosted_room_job (
                id,
                workspace_id,
                room_id,
                name,
                message,
                enabled,
                schedule,
                timezone,
                next_run_at,
                running_at,
                locked_until,
                lock_token,
                last_run_at,
                last_run_status,
                last_error,
                created_at,
                updated_at
            )
            VALUES (?1, ?2, ?3, ?1, 'Run', 1, '{}', 'UTC', NULL, NULL, NULL, NULL, NULL, NULL, NULL, ?4, ?4)
        `,
        args: [input.jobId, input.workspaceId, input.roomId, now],
    })
}

export async function insertHostedRoomJobRun(input: {
    db: Client
    workspaceId: string
    roomId: string
    runId: string
    jobId?: string | null
    now?: string
}): Promise<void> {
    const now = input.now ?? new Date(0).toISOString()
    await input.db.execute({
        sql: `
            INSERT INTO hosted_room_job_run (
                id,
                workspace_id,
                room_id,
                job_id,
                job_name,
                attempt,
                status,
                summary,
                error,
                lock_token,
                session_key,
                session_id,
                provider,
                model,
                config_version,
                started_at,
                finished_at,
                duration_ms,
                next_run_at
            )
            VALUES (?1, ?2, ?3, ?4, ?4, 1, 'running', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, ?5, NULL, NULL, NULL)
        `,
        args: [input.runId, input.workspaceId, input.roomId, input.jobId ?? null, now],
    })
}

export async function insertHostedUsageEvent(input: {
    db: Client
    workspaceId: string
    roomId: string
    usageId: string
    jobId?: string | null
    billingLedgerEntryId?: string | null
    now?: string
}): Promise<void> {
    const now = input.now ?? new Date(0).toISOString()
    await input.db.execute({
        sql: `
            INSERT INTO hosted_usage_event (
                id,
                workspace_id,
                room_id,
                session_key,
                run_id,
                job_id,
                kind,
                provider,
                model,
                tool_name,
                input_tokens,
                output_tokens,
                cached_tokens,
                cost_micros,
                billing_status,
                billing_ledger_entry_id,
                created_at
            )
            VALUES (?1, ?2, ?3, NULL, ?1, ?4, 'job', NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'not_billable', ?5, ?6)
        `,
        args: [
            input.usageId,
            input.workspaceId,
            input.roomId,
            input.jobId ?? null,
            input.billingLedgerEntryId ?? null,
            now,
        ],
    })
}

export async function insertHostedBillingLedgerEntry(input: {
    db: Client
    workspaceId: string
    ledgerId: string
    usageEventId?: string | null
    now?: string
}): Promise<void> {
    const now = input.now ?? new Date(0).toISOString()
    await input.db.execute({
        sql: `
            INSERT INTO hosted_billing_ledger_entry (
                id,
                workspace_id,
                direction,
                source,
                amount_cents,
                balance_after_cents,
                stripe_event_id,
                stripe_checkout_session_id,
                stripe_invoice_id,
                usage_event_id,
                idempotency_key,
                metadata,
                created_at
            )
            VALUES (?1, ?2, 'debit', 'hosted_brave_usage', 1, 0, NULL, NULL, NULL, ?3, ?1, '{}', ?4)
        `,
        args: [input.ledgerId, input.workspaceId, input.usageEventId ?? null, now],
    })
}

export async function insertHostedBillingReservation(input: {
    db: Client
    workspaceId: string
    roomId: string
    reservationId: string
    jobId?: string | null
    usageEventId?: string | null
    billingLedgerEntryId?: string | null
    now?: string
}): Promise<void> {
    const now = input.now ?? new Date(0).toISOString()
    await input.db.execute({
        sql: `
            INSERT INTO hosted_billing_reservation (
                id,
                workspace_id,
                room_id,
                session_key,
                run_id,
                job_id,
                provider,
                status,
                reserved_cents,
                included_reserved_cents,
                purchased_reserved_cents,
                settled_cents,
                usage_event_id,
                billing_ledger_entry_id,
                idempotency_key,
                metadata,
                expires_at,
                created_at,
                updated_at
            )
            VALUES (?1, ?2, ?3, NULL, NULL, ?4, 'brave', 'authorized', 1, 1, 0, 0, ?5, ?6, ?1, '{}', ?7, ?7, ?7)
        `,
        args: [
            input.reservationId,
            input.workspaceId,
            input.roomId,
            input.jobId ?? null,
            input.usageEventId ?? null,
            input.billingLedgerEntryId ?? null,
            now,
        ],
    })
}

export function extractTableDefinition(sql: string, tableName: string): string {
    const start = sql.indexOf(`CREATE TABLE ${tableName} `)
    if (start === -1) {
        throw new Error(`Missing D1 table ${tableName}`)
    }
    const end = sql.indexOf(';', start)
    if (end === -1) {
        throw new Error(`Missing D1 table terminator for ${tableName}`)
    }
    return sql.slice(start, end)
}

export function extractCheckValues(input: {
    sql: string
    tableName: string
    columnName: string
}): string[] {
    const tableDefinition = extractTableDefinition(input.sql, input.tableName)
    const columnPattern = new RegExp(
        `${input.columnName}\\s+TEXT\\s+NOT\\s+NULL\\s+CHECK\\s*\\(\\s*${input.columnName}\\s+IN\\s*\\(([^)]*)\\)\\s*\\)`,
        'm',
    )
    const match = tableDefinition.match(columnPattern)
    if (!match?.[1]) {
        throw new Error(`Missing D1 CHECK constraint for ${input.tableName}.${input.columnName}`)
    }
    return Array.from(match[1].matchAll(/'([^']+)'/g)).map((value) => value[1])
}

export function normalizeSqlFragment(sql: string): string {
    return sql.replace(/\s+/g, ' ').trim()
}

export function expectTableConstraint(input: {
    sql: string
    tableName: string
    constraint: string
}): void {
    expect(normalizeSqlFragment(extractTableDefinition(input.sql, input.tableName))).toContain(
        normalizeSqlFragment(input.constraint),
    )
}
