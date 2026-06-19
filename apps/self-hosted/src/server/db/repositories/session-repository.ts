import { and, eq, gt, isNull } from 'drizzle-orm'
import type { SessionRecord } from '#/domain/domain-types'
import { sessions } from '../schema'
import { mapSession } from './row-mappers'
import { createDatabaseId, nowDate, repositoryDatabase } from './repository-utils'

export const sessionRepository = {
    async createSession(input: {
        userId: string
        tokenHash: string
        expiresAt: Date
        userAgent?: string | null
        ipAddress?: string | null
    }): Promise<SessionRecord> {
        const db = await repositoryDatabase()
        const now = nowDate()
        const [row] = await db
            .insert(sessions)
            .values({
                id: createDatabaseId(),
                userId: input.userId,
                tokenHash: input.tokenHash,
                expiresAt: input.expiresAt,
                userAgent: input.userAgent ?? null,
                ipAddress: input.ipAddress ?? null,
                createdAt: now,
            })
            .returning()
        return mapSession(row)
    },

    async findActiveByTokenHash(tokenHash: string, now: Date): Promise<SessionRecord | null> {
        const db = await repositoryDatabase()
        const [row] = await db
            .select()
            .from(sessions)
            .where(
                and(
                    eq(sessions.tokenHash, tokenHash),
                    isNull(sessions.revokedAt),
                    gt(sessions.expiresAt, now),
                ),
            )
            .limit(1)
        return row ? mapSession(row) : null
    },

    async touchSession(sessionId: string, when: Date): Promise<void> {
        const db = await repositoryDatabase()
        await db.update(sessions).set({ lastSeenAt: when }).where(eq(sessions.id, sessionId))
    },

    async revokeSession(sessionId: string, when: Date): Promise<void> {
        const db = await repositoryDatabase()
        await db.update(sessions).set({ revokedAt: when }).where(eq(sessions.id, sessionId))
    },
}
