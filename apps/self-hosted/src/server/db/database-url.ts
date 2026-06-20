import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export function resolveDefaultDatabaseUrl(dataDir: string): string {
    return `file:${resolve(dataDir, 'system', 'agent-room.sqlite')}`
}

export function resolveSqliteDatabasePath(databaseUrl: string): string {
    if (!databaseUrl.startsWith('file:')) {
        throw new Error('AGENT_ROOM_DATABASE_URL must be a file: URL for self-hosted SQLite')
    }
    if (!databaseUrl.startsWith('file:/')) {
        throw new Error('AGENT_ROOM_DATABASE_URL file URLs must use an absolute path')
    }
    return fileURLToPath(databaseUrl)
}
