import { createClient, type Client } from '@libsql/client'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import type { BatchItem, BatchResponse } from 'drizzle-orm/batch'
import { drizzle, type LibSQLDatabase } from 'drizzle-orm/libsql'
import { getAppEnv } from '../config/env'
import { resolveSqliteDatabasePath } from './database-url'
import * as schema from './schema'

export type LocalDatabase = LibSQLDatabase<typeof schema>
export type AppDatabase = LocalDatabase
export type DatabaseBatchStatement = BatchItem<'sqlite'>
export type DatabaseBatchStatements = readonly [DatabaseBatchStatement, ...DatabaseBatchStatement[]]

export interface DatabaseHandle {
    db: AppDatabase
    batch: <T extends DatabaseBatchStatements>(statements: T) => Promise<BatchResponse<T>>
    close: () => Promise<void>
}

let activeHandle: DatabaseHandle | null = null
let activeHandleInit: Promise<DatabaseHandle> | null = null

function ensureSqliteParentDirectory(databaseUrl: string) {
    mkdirSync(dirname(resolveSqliteDatabasePath(databaseUrl)), { recursive: true })
}

export async function configureLocalSQLite(client: Client) {
    await client.execute('PRAGMA foreign_keys = ON')
    await client.execute('PRAGMA journal_mode = WAL')
}

export async function createLocalDatabase(databaseUrl: string): Promise<DatabaseHandle> {
    ensureSqliteParentDirectory(databaseUrl)

    const client = createClient({ url: databaseUrl })
    try {
        await configureLocalSQLite(client)

        const db = drizzle(client, { schema })

        return {
            db,
            batch: (statements) => db.batch(statements),
            close: async () => {
                client.close()
            },
        }
    } catch (error) {
        client.close()
        throw error
    }
}

async function createConfiguredDatabase(): Promise<DatabaseHandle> {
    const env = getAppEnv()
    return createLocalDatabase(env.databaseUrl)
}

export async function getDatabaseHandle(): Promise<DatabaseHandle> {
    if (activeHandle) {
        return activeHandle
    }
    if (!activeHandleInit) {
        activeHandleInit = createConfiguredDatabase()
            .then((handle) => {
                activeHandle = handle
                return handle
            })
            .finally(() => {
                activeHandleInit = null
            })
    }
    return activeHandleInit
}

export async function getDatabase(): Promise<AppDatabase> {
    return (await getDatabaseHandle()).db
}

export async function runDatabaseBatch<T extends DatabaseBatchStatements>(
    statements: T,
): Promise<BatchResponse<T>> {
    return (await getDatabaseHandle()).batch(statements)
}

export async function closeDatabase(): Promise<void> {
    const init = activeHandleInit
    const handle = activeHandle ?? (init ? await init.catch(() => null) : null)
    activeHandle = null
    activeHandleInit = null
    await handle?.close()
}

export function installDatabaseHandleForTesting(handle: DatabaseHandle): () => void {
    const previous = activeHandle
    const previousInit = activeHandleInit
    activeHandle = handle
    activeHandleInit = null
    return () => {
        activeHandle = previous
        activeHandleInit = previousInit
    }
}
