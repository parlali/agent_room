import { randomUUID } from 'node:crypto'
import { sql } from 'drizzle-orm'
import {
    getDatabase,
    runDatabaseBatch,
    type DatabaseBatchStatements,
    type LocalDatabase,
} from '../client'

export async function repositoryDatabase(): Promise<LocalDatabase> {
    return getDatabase()
}

export async function repositoryBatch<T extends DatabaseBatchStatements>(statements: T) {
    return runDatabaseBatch(statements)
}

export function createDatabaseId(): string {
    return randomUUID()
}

export function nowDate(): Date {
    return new Date()
}

export function excluded(columnName: string) {
    return sql.raw(`excluded.${columnName}`)
}

export function computeLeaseUntil(input: {
    now: Date
    everyMinutes: number
    runBudgetMs: number
    maxStaleLockMs: number
}): Date {
    const jobIntervalMs = Math.max(0, input.everyMinutes) * 60_000
    const desiredLeaseMs = Math.max(300_000, Math.min(jobIntervalMs, input.runBudgetMs + 60_000))
    const boundedLeaseMs = Math.min(input.maxStaleLockMs, desiredLeaseMs)
    return new Date(input.now.getTime() + boundedLeaseMs)
}
