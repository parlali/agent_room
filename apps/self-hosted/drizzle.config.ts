import { defineConfig } from 'drizzle-kit'
import { resolve } from 'node:path'
import { resolveDefaultDatabaseUrl } from './src/server/db/database-url'

const dataDir = resolve(process.env.AGENT_ROOM_DATA_DIR ?? '.agent-room')

export default defineConfig({
    schema: './src/server/db/schema.ts',
    out: './db/migrations',
    dialect: 'sqlite',
    dbCredentials: {
        url: process.env.AGENT_ROOM_DATABASE_URL ?? resolveDefaultDatabaseUrl(dataDir),
    },
    casing: 'snake_case',
    breakpoints: true,
})
