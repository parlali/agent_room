import type { D1Database, R2Bucket } from '@cloudflare/workers-types'
import { describe, expect, it } from 'vitest'
import type { AgentRoomHostedEnv } from './bindings'
import { writeHostedRuntimeStateTransition } from './hosted-runtime-state-repository'

interface RuntimeStatement {
    sql: string
    args: unknown[]
}

function hostedEnv(input: { batchChanges: number[] }): AgentRoomHostedEnv {
    return {
        AGENT_ROOM_DB: {
            prepare: (sql: string) => ({
                bind: (...args: unknown[]): RuntimeStatement => ({
                    sql,
                    args,
                }),
            }),
            batch: async (statements: RuntimeStatement[]) =>
                statements.map((_, index) => ({
                    success: true,
                    meta: {
                        changes: input.batchChanges[index] ?? 1,
                    },
                    results: [],
                })),
        } as unknown as D1Database,
        AGENT_ROOM_WORKSPACE_BUCKET: {} as R2Bucket,
        AGENT_ROOM_RUNTIME_JOBS: {} as AgentRoomHostedEnv['AGENT_ROOM_RUNTIME_JOBS'],
        AGENT_ROOM_RUNTIME: {} as AgentRoomHostedEnv['AGENT_ROOM_RUNTIME'],
        AGENT_ROOM_AUTH_MODE: 'better-auth',
        AGENT_ROOM_RUNTIME_BACKEND: 'cloudflare-containers',
        AGENT_ROOM_RUNTIME_STORAGE: 'r2',
        BETTER_AUTH_SECRET: 'a'.repeat(32),
        BETTER_AUTH_URL: 'https://rooms.example.test',
        GOOGLE_CLIENT_ID: 'google-client',
        GOOGLE_CLIENT_SECRET: 'google-secret',
        AGENT_ROOM_EMAIL_WEBHOOK_URL: 'https://mail.example.test/send',
        AGENT_ROOM_EMAIL_WEBHOOK_BEARER_TOKEN: 'b'.repeat(16),
        AGENT_ROOM_EMAIL_FROM: 'Agent Room <noreply@example.test>',
    }
}

describe('hosted runtime state repository', () => {
    it('fails closed when a runtime state transition updates no runtime row', async () => {
        await expect(
            writeHostedRuntimeStateTransition({
                env: hostedEnv({
                    batchChanges: [0, 1],
                }),
                workspaceId: 'workspace_1',
                roomId: 'room_1',
                transition: {
                    kind: 'starting',
                },
                now: new Date(0).toISOString(),
            }),
        ).rejects.toThrow(/statement 1/)
    })

    it('fails closed when a runtime state transition updates no room row', async () => {
        await expect(
            writeHostedRuntimeStateTransition({
                env: hostedEnv({
                    batchChanges: [1, 0],
                }),
                workspaceId: 'workspace_1',
                roomId: 'room_1',
                transition: {
                    kind: 'running',
                },
                now: new Date(0).toISOString(),
            }),
        ).rejects.toThrow(/statement 2/)
    })
})
