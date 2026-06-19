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
    const handle = await createLocalDatabase(`file:${join(root, 'agent-room.sqlite')}`)
    await migrate(handle.db as LocalDatabase, {
        migrationsFolder: resolve('db/migrations'),
    })
    const restore = installDatabaseHandleForTesting(handle)

    return {
        db: handle.db as LocalDatabase,
        close: async () => {
            restore()
            await handle.close()
            await rm(root, { recursive: true, force: true })
        },
    }
}
