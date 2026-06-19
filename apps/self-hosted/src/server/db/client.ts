import { createClient, type Client } from '@libsql/client'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { drizzle, type LibSQLDatabase } from 'drizzle-orm/libsql'
import type { DrizzleD1Database } from 'drizzle-orm/d1'
import { getAppEnv } from '../config/env'
import * as schema from './schema'

export type LocalDatabase = LibSQLDatabase<typeof schema>
export type D1DatabaseHandle = DrizzleD1Database<typeof schema>
export type AppDatabase = LocalDatabase | D1DatabaseHandle

export interface DatabaseHandle {
    db: AppDatabase
    batch: (statements: unknown[]) => Promise<unknown[]>
    close: () => Promise<void>
}

let activeHandle: DatabaseHandle | null = null

function sqlitePathFromUrl(databaseUrl: string): string | null {
    if (!databaseUrl.startsWith('file:')) {
        return null
    }
    if (!databaseUrl.startsWith('file:/')) {
        throw new Error('AGENT_ROOM_DATABASE_URL file URLs must use an absolute path')
    }

    return fileURLToPath(databaseUrl)
}

function ensureSqliteParentDirectory(databaseUrl: string) {
    const filePath = sqlitePathFromUrl(databaseUrl)
    if (filePath) {
        mkdirSync(dirname(filePath), { recursive: true })
    }
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
    if (env.databaseDriver === 'd1') {
        throw new Error('AGENT_ROOM_DATABASE_DRIVER=d1 requires a hosted D1 binding')
    }
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
