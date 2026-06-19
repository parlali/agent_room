import { count, eq } from 'drizzle-orm'
import type { UserRecord, UserRole } from '#/domain/domain-types'
import { users } from '../schema'
import { mapUser } from './row-mappers'
import { createDatabaseId, nowDate, repositoryDatabase } from './repository-utils'

export const userRepository = {
    async countUsers(): Promise<number> {
        const db = await repositoryDatabase()
        const [row] = await db.select({ count: count() }).from(users)
        return row?.count ?? 0
    },

    async findByEmail(email: string): Promise<UserRecord | null> {
        const db = await repositoryDatabase()
        const [row] = await db.select().from(users).where(eq(users.email, email)).limit(1)
        return row ? mapUser(row) : null
    },

    async findById(userId: string): Promise<UserRecord | null> {
        const db = await repositoryDatabase()
        const [row] = await db.select().from(users).where(eq(users.id, userId)).limit(1)
        return row ? mapUser(row) : null
    },

    async createUser(input: {
        email: string
        passwordHash: string
        role: UserRole
    }): Promise<UserRecord> {
        const db = await repositoryDatabase()
        const now = nowDate()
        const [row] = await db
            .insert(users)
            .values({
                id: createDatabaseId(),
                email: input.email,
                passwordHash: input.passwordHash,
                role: input.role,
                createdAt: now,
                updatedAt: now,
            })
            .returning()
        return mapUser(row)
    },
}
