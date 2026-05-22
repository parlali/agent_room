import { beforeEach, describe, expect, it, vi } from 'vitest'
import { __testing } from './codex-oauth-flow'

const mocks = vi.hoisted(() => ({
    reconcileRoomAutostart: vi.fn(),
}))

vi.mock('../rooms/room-autostart', () => ({
    reconcileRoomAutostart: mocks.reconcileRoomAutostart,
}))

describe('codex oauth flow helpers', () => {
    beforeEach(() => {
        mocks.reconcileRoomAutostart.mockReset()
        mocks.reconcileRoomAutostart.mockResolvedValue({
            started: true,
            blocked: false,
            skipped: false,
        })
    })

    it('accepts full redirect URLs with code and state parameters', () => {
        expect(
            __testing.validateRedirectUrlValue(
                'http://localhost:1455/auth/callback?code=abc&state=expected',
            ),
        ).toBe('http://localhost:1455/auth/callback?code=abc&state=expected')
    })

    it('rejects redirect URLs missing OAuth state', () => {
        expect(() =>
            __testing.validateRedirectUrlValue('http://localhost:1455/auth/callback?code=abc'),
        ).toThrow('Redirect URL must include code and state parameters')
    })

    it('reconciles desired-running room runtime after OAuth completes', async () => {
        await __testing.reconcileRuntimeAfterCodexOAuth({
            roomId: 'room-1',
            actorUserId: 'user-1',
            status: 'complete',
            authUrl: null,
            profilePath: '/tmp/profile.json',
            message: 'OpenAI Codex profile is ready',
            startedAt: new Date('2026-01-01T00:00:00.000Z'),
            updatedAt: new Date('2026-01-01T00:00:00.000Z'),
            completedAt: new Date('2026-01-01T00:00:00.000Z'),
            manualResolve: null,
            manualReject: null,
            timeout: null,
            flowId: 'flow-1',
        } as never)

        expect(mocks.reconcileRoomAutostart).toHaveBeenCalledWith({
            roomId: 'room-1',
            actorUserId: 'user-1',
            trigger: 'codex_oauth_completed',
        })
    })
})
