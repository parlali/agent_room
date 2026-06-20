import { and, eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { LocalDatabase } from '../client'
import { createMigratedTestDatabase } from '../sqlite-test-helper'
import { rooms, sessionComposerDrafts, sessions, users } from '../schema'
import { maxSessionComposerDraftLength } from '#/domain/session-composer-draft'
import { sessionComposerDraftRepository } from './session-composer-draft-repository'

let db: LocalDatabase
let closeDatabase: (() => Promise<void>) | null = null

const draftKey = and(
    eq(sessionComposerDrafts.authSessionId, 'auth-session-1'),
    eq(sessionComposerDrafts.roomId, 'room-1'),
    eq(sessionComposerDrafts.sessionKey, 'thread-1'),
)

describe('session composer draft repository', () => {
    beforeEach(async () => {
        const database = await createMigratedTestDatabase('agent-room-draft-repository-')
        db = database.db
        closeDatabase = database.close

        const now = new Date('2026-05-20T10:00:00.000Z')
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
        await db.insert(sessions).values({
            id: 'auth-session-1',
            userId: 'user-1',
            tokenHash: 'token-hash',
            expiresAt: new Date('2026-05-21T10:00:00.000Z'),
            createdAt: now,
        })
    })

    afterEach(async () => {
        await closeDatabase?.()
        closeDatabase = null
    })

    it('persists and reads a draft for one browser session, room, and chat session', async () => {
        const draft = await sessionComposerDraftRepository.upsert({
            authSessionId: 'auth-session-1',
            roomId: 'room-1',
            sessionKey: 'thread-1',
            draft: 'half-written prompt',
        })

        expect(draft).toMatchObject({
            authSessionId: 'auth-session-1',
            roomId: 'room-1',
            sessionKey: 'thread-1',
            draft: 'half-written prompt',
        })
        await expect(
            sessionComposerDraftRepository.find({
                authSessionId: 'auth-session-1',
                roomId: 'room-1',
                sessionKey: 'thread-1',
            }),
        ).resolves.toMatchObject({
            draft: 'half-written prompt',
        })
    })

    it('deletes the draft row when the draft is empty', async () => {
        await sessionComposerDraftRepository.upsert({
            authSessionId: 'auth-session-1',
            roomId: 'room-1',
            sessionKey: 'thread-1',
            draft: 'half-written prompt',
        })

        const draft = await sessionComposerDraftRepository.upsert({
            authSessionId: 'auth-session-1',
            roomId: 'room-1',
            sessionKey: 'thread-1',
            draft: '',
        })

        const rows = await db.select().from(sessionComposerDrafts).where(draftKey)
        expect(draft).toBeNull()
        expect(rows).toHaveLength(0)
    })

    it('rejects drafts beyond the canonical length bound before writing', async () => {
        await expect(
            sessionComposerDraftRepository.upsert({
                authSessionId: 'auth-session-1',
                roomId: 'room-1',
                sessionKey: 'thread-1',
                draft: 'x'.repeat(maxSessionComposerDraftLength + 1),
            }),
        ).rejects.toThrow('Composer draft is too long')

        const rows = await db.select().from(sessionComposerDrafts).where(draftKey)
        expect(rows).toHaveLength(0)
    })

    it('clears all browser-session drafts for a deleted chat session', async () => {
        await sessionComposerDraftRepository.upsert({
            authSessionId: 'auth-session-1',
            roomId: 'room-1',
            sessionKey: 'thread-1',
            draft: 'half-written prompt',
        })

        await sessionComposerDraftRepository.deleteByRoomSession({
            roomId: 'room-1',
            sessionKey: 'thread-1',
        })

        const rows = await db.select().from(sessionComposerDrafts).where(draftKey)
        expect(rows).toHaveLength(0)
    })

    it('clears all drafts when an auth session is revoked', async () => {
        await sessionComposerDraftRepository.upsert({
            authSessionId: 'auth-session-1',
            roomId: 'room-1',
            sessionKey: 'thread-1',
            draft: 'half-written prompt',
        })

        await sessionComposerDraftRepository.deleteByAuthSession('auth-session-1')

        const rows = await db.select().from(sessionComposerDrafts).where(draftKey)
        expect(rows).toHaveLength(0)
    })
})
