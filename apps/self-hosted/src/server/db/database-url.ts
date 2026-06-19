import { resolve } from 'node:path'

export function resolveDefaultDatabaseUrl(dataDir: string): string {
    return `file:${resolve(dataDir, 'system', 'agent-room.sqlite')}`
}
