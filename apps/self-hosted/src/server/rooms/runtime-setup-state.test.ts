import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { LocalDatabase } from '../db/client'
import { auditEvents, rooms, users } from '../db/schema'
import { createMigratedTestDatabase } from '../db/sqlite-test-helper'
import { markRoomSetupRequired } from './runtime-setup-state'

let db: LocalDatabase
let closeDatabase: (() => Promise<void>) | null = null

describe('markRoomSetupRequired', () => {
    beforeEach(async () => {
        const database = await createMigratedTestDatabase('agent-room-runtime-setup-')
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
            status: 'stopped',
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

    it('updates room status and appends the audit event in one batch', async () => {
        await markRoomSetupRequired({
            roomId: 'room-1',
            actorUserId: 'user-1',
            trigger: 'room_config_saved',
            error: 'missing provider',
        })

        const [room] = await db.select().from(rooms).where(eq(rooms.id, 'room-1')).limit(1)
        const [audit] = await db.select().from(auditEvents).limit(1)

        expect(room?.status).toBe('setup_required')
        expect(audit).toMatchObject({
            actorUserId: 'user-1',
            roomId: 'room-1',
            action: 'room.runtime_start_blocked',
            payload: {
                trigger: 'room_config_saved',
                error: 'missing provider',
            },
        })
    })

    it('rolls back the status update when the audit insert fails', async () => {
        await expect(
            markRoomSetupRequired({
                roomId: 'room-1',
                actorUserId: 'missing-user',
                trigger: 'runtime_boot',
            }),
        ).rejects.toThrow()

        const [room] = await db.select().from(rooms).where(eq(rooms.id, 'room-1')).limit(1)
        const audits = await db.select().from(auditEvents)

        expect(room?.status).toBe('stopped')
        expect(audits).toHaveLength(0)
    })
})
