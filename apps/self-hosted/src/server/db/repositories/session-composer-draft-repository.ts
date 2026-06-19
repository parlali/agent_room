import { and, eq } from 'drizzle-orm'
import { maxSessionComposerDraftLength } from '#/domain/session-composer-draft'
import type { SessionComposerDraftRecord } from '#/domain/domain-types'
import { sessionComposerDrafts } from '../schema'
import { mapSessionComposerDraft } from './row-mappers'
import { excluded, nowDate, repositoryDatabase } from './repository-utils'

const draftKey = (input: { authSessionId: string; roomId: string; sessionKey: string }) =>
    and(
        eq(sessionComposerDrafts.authSessionId, input.authSessionId),
        eq(sessionComposerDrafts.roomId, input.roomId),
        eq(sessionComposerDrafts.sessionKey, input.sessionKey),
    )

export const sessionComposerDraftRepository = {
    async find(input: {
        authSessionId: string
        roomId: string
        sessionKey: string
    }): Promise<SessionComposerDraftRecord | null> {
        const db = await repositoryDatabase()
        const [row] = await db.select().from(sessionComposerDrafts).where(draftKey(input)).limit(1)
        return row ? mapSessionComposerDraft(row) : null
    },

    async upsert(input: {
        authSessionId: string
        roomId: string
        sessionKey: string
        draft: string
    }): Promise<SessionComposerDraftRecord | null> {
        if (input.draft.length === 0) {
            await sessionComposerDraftRepository.delete(input)
            return null
        }
        if (input.draft.length > maxSessionComposerDraftLength) {
            throw new Error('Composer draft is too long')
        }

        const db = await repositoryDatabase()
        const now = nowDate()
        const [row] = await db
            .insert(sessionComposerDrafts)
            .values({
                authSessionId: input.authSessionId,
                roomId: input.roomId,
                sessionKey: input.sessionKey,
                draft: input.draft,
                createdAt: now,
                updatedAt: now,
            })
            .onConflictDoUpdate({
                target: [
                    sessionComposerDrafts.authSessionId,
                    sessionComposerDrafts.roomId,
                    sessionComposerDrafts.sessionKey,
                ],
                set: {
                    draft: excluded('draft'),
                    updatedAt: now,
                },
            })
            .returning()
        return mapSessionComposerDraft(row)
    },

    async delete(input: {
        authSessionId: string
        roomId: string
        sessionKey: string
    }): Promise<void> {
        const db = await repositoryDatabase()
        await db.delete(sessionComposerDrafts).where(draftKey(input))
    },

    async deleteByRoomSession(input: { roomId: string; sessionKey: string }): Promise<void> {
        const db = await repositoryDatabase()
        await db
            .delete(sessionComposerDrafts)
            .where(
                and(
                    eq(sessionComposerDrafts.roomId, input.roomId),
                    eq(sessionComposerDrafts.sessionKey, input.sessionKey),
                ),
            )
    },

    async deleteByAuthSession(authSessionId: string): Promise<void> {
        const db = await repositoryDatabase()
        await db
            .delete(sessionComposerDrafts)
            .where(eq(sessionComposerDrafts.authSessionId, authSessionId))
    },
}
