import { beforeEach, describe, expect, it, vi } from 'vitest'

import { maxSessionComposerDraftLength } from '#/domain/session-composer-draft'
import { sessionComposerDraftRepository } from './session-composer-draft-repository'

const mocks = vi.hoisted(() => ({
    sql: vi.fn(),
}))

vi.mock('../client', () => ({
    sql: mocks.sql,
}))

describe('session composer draft repository', () => {
    beforeEach(() => {
        mocks.sql.mockReset()
    })

    it('persists a draft for one browser session, room, and chat session', async () => {
        const createdAt = new Date('2026-05-20T10:00:00.000Z')
        const updatedAt = new Date('2026-05-20T10:01:00.000Z')
        mocks.sql.mockResolvedValueOnce([
            {
                auth_session_id: 'auth-session-1',
                room_id: 'room-1',
                session_key: 'thread-1',
                draft: 'half-written prompt',
                created_at: createdAt,
                updated_at: updatedAt,
            },
        ])

        const draft = await sessionComposerDraftRepository.upsert({
            authSessionId: 'auth-session-1',
            roomId: 'room-1',
            sessionKey: 'thread-1',
            draft: 'half-written prompt',
        })

        expect(statementAt(0)).toContain('INSERT INTO session_composer_drafts')
        expect(mocks.sql.mock.calls[0]?.slice(1, 5)).toEqual([
            'auth-session-1',
            'room-1',
            'thread-1',
            'half-written prompt',
        ])
        expect(draft).toEqual({
            authSessionId: 'auth-session-1',
            roomId: 'room-1',
            sessionKey: 'thread-1',
            draft: 'half-written prompt',
            createdAt,
            updatedAt,
        })
    })

    it('deletes the draft row when the draft is empty', async () => {
        mocks.sql.mockResolvedValueOnce([])

        const draft = await sessionComposerDraftRepository.upsert({
            authSessionId: 'auth-session-1',
            roomId: 'room-1',
            sessionKey: 'thread-1',
            draft: '',
        })

        expect(draft).toBeNull()
        expect(statementAt(0)).toContain('DELETE FROM session_composer_drafts')
        expect(mocks.sql.mock.calls[0]?.slice(1, 4)).toEqual([
            'auth-session-1',
            'room-1',
            'thread-1',
        ])
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

        expect(mocks.sql).not.toHaveBeenCalled()
    })

    it('clears all browser-session drafts for a deleted chat session', async () => {
        mocks.sql.mockResolvedValueOnce([])

        await sessionComposerDraftRepository.deleteByRoomSession({
            roomId: 'room-1',
            sessionKey: 'thread-1',
        })

        expect(statementAt(0)).toContain('DELETE FROM session_composer_drafts')
        expect(statementAt(0)).not.toContain('auth_session_id')
        expect(mocks.sql.mock.calls[0]?.slice(1, 3)).toEqual(['room-1', 'thread-1'])
    })

    it('clears all drafts when an auth session is revoked', async () => {
        mocks.sql.mockResolvedValueOnce([])

        await sessionComposerDraftRepository.deleteByAuthSession('auth-session-1')

        expect(statementAt(0)).toContain('DELETE FROM session_composer_drafts')
        expect(statementAt(0)).toContain('auth_session_id')
        expect(mocks.sql.mock.calls[0]?.slice(1, 2)).toEqual(['auth-session-1'])
    })
})

function statementAt(index: number): string {
    const strings = mocks.sql.mock.calls[index]?.[0]
    return Array.from(strings ?? []).join(' ')
}
