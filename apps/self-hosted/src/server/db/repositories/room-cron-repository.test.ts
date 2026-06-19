import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { LocalDatabase } from '../client'
import { roomCronJobs, rooms, users } from '../schema'
import { createMigratedTestDatabase } from '../sqlite-test-helper'
import { roomCronRepository } from './room-cron-repository'

let db: LocalDatabase
let closeDatabase: (() => Promise<void>) | null = null

describe('room cron repository', () => {
    beforeEach(async () => {
        const database = await createMigratedTestDatabase('agent-room-cron-repository-')
        db = database.db
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
            status: 'running',
            desiredState: 'running',
            createdByUserId: 'user-1',
            createdAt: now,
            updatedAt: now,
        })
    })

    afterEach(async () => {
        await closeDatabase?.()
        closeDatabase = null
    })

    it('claims due jobs with guarded updates and recovers expired leases', async () => {
        const job = await roomCronRepository.createJob({
            roomId: 'room-1',
            name: 'Daily sync',
            message: 'sync',
            everyMinutes: 30,
            schedule: { type: 'daily', times: ['09:00'] },
            timezone: 'UTC',
            nextRunAt: new Date('2026-06-19T11:59:00.000Z'),
            provider: 'openrouter',
            model: 'model',
            configVersion: 7,
        })

        const firstClaim = await roomCronRepository.claimDueJobs({
            lockToken: 'token-1',
            runBudgetMs: 600_000,
            maxStaleLockMs: 900_000,
            limit: 1,
        })
        const secondClaim = await roomCronRepository.claimDueJobs({
            lockToken: 'token-2',
            runBudgetMs: 600_000,
            maxStaleLockMs: 900_000,
            limit: 1,
        })

        expect(firstClaim).toHaveLength(1)
        expect(firstClaim[0]?.id).toBe(job.id)
        expect(firstClaim[0]?.lockToken).toBe('token-1')
        expect(secondClaim).toHaveLength(0)

        await db
            .update(roomCronJobs)
            .set({
                lockedUntil: new Date('2026-06-19T11:00:00.000Z'),
            })
            .where(eq(roomCronJobs.id, job.id))

        const recovered = await roomCronRepository.claimDueJobs({
            lockToken: 'token-2',
            runBudgetMs: 600_000,
            maxStaleLockMs: 900_000,
            limit: 1,
        })

        expect(recovered).toHaveLength(1)
        expect(recovered[0]?.lockToken).toBe('token-2')
        expect(recovered[0]?.recoveryReason).toBe('expired_lease')
    })
})
