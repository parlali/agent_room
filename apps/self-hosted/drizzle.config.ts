import { defineConfig } from 'drizzle-kit'
import { resolveSqliteDatabasePath } from './src/server/db/database-url'

function requireDatabaseUrl(): string {
    const databaseUrl = process.env.AGENT_ROOM_DATABASE_URL
    if (!databaseUrl) {
        throw new Error(
            'AGENT_ROOM_DATABASE_URL must be set when running Drizzle Kit commands. Use an absolute file: SQLite URL.',
        )
    }
    resolveSqliteDatabasePath(databaseUrl)
    return databaseUrl
}

const databaseUrl = requireDatabaseUrl()

export default defineConfig({
    schema: './src/server/db/schema.ts',
    out: './db/migrations',
    dialect: 'sqlite',
    dbCredentials: {
        url: databaseUrl,
    },
    casing: 'snake_case',
    breakpoints: true,
})
