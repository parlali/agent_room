import { resolve } from 'node:path'
import { migrate } from 'drizzle-orm/libsql/migrator'
import { closeDatabase, getDatabaseHandle } from '../src/server/db/client'

async function main() {
    const handle = await getDatabaseHandle()
    await migrate(handle.db, {
        migrationsFolder: resolve('db/migrations'),
    })
    await closeDatabase()
}

main().catch(async (error) => {
    console.error(error)
    await closeDatabase()
    process.exit(1)
})
