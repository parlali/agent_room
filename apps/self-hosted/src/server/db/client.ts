import { createClient, type Client } from '@libsql/client'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { drizzle, type LibSQLDatabase } from 'drizzle-orm/libsql'
import { getAppEnv } from '../config/env'
import { resolveSqliteDatabasePath } from './database-url'
import * as schema from './schema'

export type LocalDatabase = LibSQLDatabase<typeof schema>
export type AppDatabase = LocalDatabase

export interface DatabaseHandle {
    db: AppDatabase
    batch: (statements: unknown[]) => Promise<unknown[]>
    close: () => Promise<void>
}

let activeHandle: DatabaseHandle | null = null

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
    await configureLocalSQLite(client)

    const db = drizzle(client, { schema })

    return {
        db,
        batch: (statements) => db.batch(statements as never) as Promise<unknown[]>,
        close: async () => {
            client.close()
        },
    }
}

async function createConfiguredDatabase(): Promise<DatabaseHandle> {
    const env = getAppEnv()
    return createLocalDatabase(env.databaseUrl)
}

export async function getDatabaseHandle(): Promise<DatabaseHandle> {
    activeHandle ??= await createConfiguredDatabase()
    return activeHandle
}

export async function getDatabase(): Promise<AppDatabase> {
    return (await getDatabaseHandle()).db
}

export async function runDatabaseBatch(statements: unknown[]): Promise<unknown[]> {
    return (await getDatabaseHandle()).batch(statements)
}

export async function closeDatabase(): Promise<void> {
    const handle = activeHandle
    activeHandle = null
    await handle?.close()
}

export function installDatabaseHandleForTesting(handle: DatabaseHandle): () => void {
    const previous = activeHandle
    activeHandle = handle
    return () => {
        activeHandle = previous
    }
}
