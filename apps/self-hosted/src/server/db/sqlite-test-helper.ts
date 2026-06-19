import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { migrate } from 'drizzle-orm/libsql/migrator'
import { createLocalDatabase, installDatabaseHandleForTesting, type LocalDatabase } from './client'

export async function createMigratedTestDatabase(prefix: string): Promise<{
    db: LocalDatabase
    close: () => Promise<void>
}> {
    const root = await mkdtemp(join(tmpdir(), prefix))
    let handle: Awaited<ReturnType<typeof createLocalDatabase>> | null = null
    try {
        handle = await createLocalDatabase(`file:${join(root, 'agent-room.sqlite')}`)
        await migrate(handle.db, {
            migrationsFolder: resolve('db/migrations'),
        })
    } catch (error) {
        await handle?.close()
        await rm(root, { recursive: true, force: true })
        throw error
    }

    const restore = installDatabaseHandleForTesting(handle)
    return {
        db: handle.db,
        close: async () => {
            restore()
            await handle.close()
            await rm(root, { recursive: true, force: true })
        },
    }
}
