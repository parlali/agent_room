import type { SessionRecord } from '../../domain/types'
import { sql } from '../client'
import { mapSession } from './row-mappers'

export const sessionRepository = {
    async createSession(input: {
        userId: string
        tokenHash: string
        expiresAt: Date
        userAgent?: string | null
        ipAddress?: string | null
    }): Promise<SessionRecord> {
        const rows = await sql`
            INSERT INTO sessions (user_id, token_hash, expires_at, user_agent, ip_address)
            VALUES (${input.userId}, ${input.tokenHash}, ${input.expiresAt}, ${input.userAgent ?? null}, ${input.ipAddress ?? null})
            RETURNING *
        `
        return mapSession(rows[0] as Record<string, unknown>)
    },

    async findActiveByTokenHash(tokenHash: string, now: Date): Promise<SessionRecord | null> {
        const rows = await sql`
            SELECT *
            FROM sessions
            WHERE token_hash = ${tokenHash}
              AND revoked_at IS NULL
              AND expires_at > ${now}
            LIMIT 1
        `
        if (rows.length === 0) {
            return null
        }
        return mapSession(rows[0] as Record<string, unknown>)
    },

    async touchSession(sessionId: string, when: Date): Promise<void> {
        await sql`UPDATE sessions SET last_seen_at = ${when} WHERE id = ${sessionId}`
    },

    async revokeSession(sessionId: string, when: Date): Promise<void> {
        await sql`UPDATE sessions SET revoked_at = ${when} WHERE id = ${sessionId}`
    },
}
