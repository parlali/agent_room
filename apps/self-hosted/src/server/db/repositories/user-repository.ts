import type { UserRecord, UserRole } from '#/domain/domain-types'
import { sql } from '../client'
import { mapUser } from './row-mappers'

export const userRepository = {
    async countUsers(): Promise<number> {
        const [row] = await sql<{ count: string }[]>`SELECT count(*)::text AS count FROM users`
        if (!row) {
            return 0
        }
        return Number(row.count)
    },

    async findByEmail(email: string): Promise<UserRecord | null> {
        const rows = await sql`SELECT * FROM users WHERE email = ${email} LIMIT 1`
        if (rows.length === 0) {
            return null
        }
        return mapUser(rows[0] as Record<string, unknown>)
    },

    async findById(userId: string): Promise<UserRecord | null> {
        const rows = await sql`SELECT * FROM users WHERE id = ${userId} LIMIT 1`
        if (rows.length === 0) {
            return null
        }
        return mapUser(rows[0] as Record<string, unknown>)
    },

    async createUser(input: {
        email: string
        passwordHash: string
        role: UserRole
    }): Promise<UserRecord> {
        const rows = await sql`
            INSERT INTO users (email, password_hash, role)
            VALUES (${input.email}, ${input.passwordHash}, ${input.role})
            RETURNING *
        `
        return mapUser(rows[0] as Record<string, unknown>)
    },
}
