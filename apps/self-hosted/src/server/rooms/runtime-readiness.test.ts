import { describe, expect, it } from 'vitest'
import { assertRoomSetupReady, type RoomSetupReadinessSnapshot } from './runtime-readiness'

function createReadiness(input?: {
    hasBlockingIssues?: boolean
    issueMessage?: string
}): RoomSetupReadinessSnapshot {
    return {
        command: 'bun',
        generatedAt: '2026-04-21T00:00:00.000Z',
        hasBlockingIssues: input?.hasBlockingIssues ?? false,
        issues:
            (input?.hasBlockingIssues ?? false)
                ? [
                      {
                          code: 'runtime_command_unavailable',
                          severity: 'blocking',
                          message:
                              input?.issueMessage ?? 'Bundled Pi runtime command is unavailable',
                      },
                  ]
                : [],
    }
}

describe('runtime readiness helpers', () => {
    it('passes when the bundled runtime is available', () => {
        expect(() =>
            assertRoomSetupReady({
                readiness: createReadiness(),
            }),
        ).not.toThrow()
    })

    it('fails closed when the bundled runtime is unavailable', () => {
        expect(() =>
            assertRoomSetupReady({
                readiness: createReadiness({
                    hasBlockingIssues: true,
                    issueMessage: 'Bundled Pi runtime command is unavailable: command probe failed',
                }),
            }),
        ).toThrow('Bundled Pi runtime command is unavailable: command probe failed')
    })
})
