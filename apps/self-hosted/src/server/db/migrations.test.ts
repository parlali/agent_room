import { afterEach, describe, expect, it } from 'vitest'
import type { LocalDatabase } from './client'
import { createMigratedTestDatabase } from './sqlite-test-helper'
import { rooms, users } from './schema'

let closeDatabase: (() => Promise<void>) | null = null

describe('Drizzle SQLite migrations', () => {
    afterEach(async () => {
        await closeDatabase?.()
        closeDatabase = null
    })

    it('applies the baseline migration and supports the core room tables', async () => {
        const database = await createMigratedTestDatabase('agent-room-migration-')
        const db: LocalDatabase = database.db
        closeDatabase = database.close
        const now = new Date('2026-06-19T12:00:00.000Z')

        await db.insert(users).values({
            id: 'user-1',
            email: 'root@example.test',
            passwordHash: 'hash',
            role: 'root',
            createdAt: now,
            updatedAt: now,
        })
        await db.insert(rooms).values({
            id: 'room-1',
            slug: 'room-1',
            displayName: 'Room 1',
            status: 'stopped',
            desiredState: 'stopped',
            createdByUserId: 'user-1',
            createdAt: now,
            updatedAt: now,
        })

        const rows = await db.select().from(rooms)
        expect(rows).toHaveLength(1)
        expect(rows[0]?.createdAt).toBeInstanceOf(Date)
    })
})
