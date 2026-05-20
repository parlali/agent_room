import { maxSessionComposerDraftLength } from '#/lib/session-composer-draft'
import type { SessionComposerDraftRecord } from '../../domain/types'
import { sql } from '../client'
import { mapSessionComposerDraft } from './row-mappers'

export const sessionComposerDraftRepository = {
    async find(input: {
        authSessionId: string
        roomId: string
        sessionKey: string
    }): Promise<SessionComposerDraftRecord | null> {
        const rows = await sql`
            SELECT *
            FROM session_composer_drafts
            WHERE auth_session_id = ${input.authSessionId}
              AND room_id = ${input.roomId}
              AND session_key = ${input.sessionKey}
            LIMIT 1
        `
        if (rows.length === 0) {
            return null
        }
        return mapSessionComposerDraft(rows[0] as Record<string, unknown>)
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

        const rows = await sql`
            INSERT INTO session_composer_drafts (
                auth_session_id,
                room_id,
                session_key,
                draft
            )
            VALUES (
                ${input.authSessionId},
                ${input.roomId},
                ${input.sessionKey},
                ${input.draft}
            )
            ON CONFLICT (auth_session_id, room_id, session_key)
            DO UPDATE SET
                draft = excluded.draft,
                updated_at = now()
            RETURNING *
        `
        return mapSessionComposerDraft(rows[0] as Record<string, unknown>)
    },

    async delete(input: {
        authSessionId: string
        roomId: string
        sessionKey: string
    }): Promise<void> {
        await sql`
            DELETE FROM session_composer_drafts
            WHERE auth_session_id = ${input.authSessionId}
              AND room_id = ${input.roomId}
              AND session_key = ${input.sessionKey}
        `
    },

    async deleteByRoomSession(input: { roomId: string; sessionKey: string }): Promise<void> {
        await sql`
            DELETE FROM session_composer_drafts
            WHERE room_id = ${input.roomId}
              AND session_key = ${input.sessionKey}
        `
    },

    async deleteByAuthSession(authSessionId: string): Promise<void> {
        await sql`
            DELETE FROM session_composer_drafts
            WHERE auth_session_id = ${authSessionId}
        `
    },
}
