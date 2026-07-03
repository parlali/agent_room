import type { D1Database } from '@cloudflare/workers-types'
import { describe, expect, it, vi } from 'vitest'
import type { AgentRoomHostedEnv } from './bindings'
import { hostedTestEnv } from './hosted-env-test-support'
import {
    handleHostedRuntimeContainerStop,
    parseHostedRuntimeContainerName,
} from './hosted-runtime-container-stop'
import { hostedRuntimeContainerName } from './runtime-contract'

function stopParams() {
    return {
        exitCode: 0,
        reason: 'exit' as const,
    }
}

function batchEnv(input: { batchChanges?: number[]; batchError?: Error }): {
    env: AgentRoomHostedEnv
    batch: ReturnType<typeof vi.fn>
} {
    const batch = vi.fn(async (statements: unknown[]) => {
        if (input.batchError) {
            throw input.batchError
        }
        return statements.map((_, index) => ({
            success: true,
            meta: {
                changes: input.batchChanges?.[index] ?? 0,
            },
            results: [],
        }))
    })
    const env = hostedTestEnv({
        AGENT_ROOM_DB: {
            prepare: (sql: string) => ({
                bind: (...args: unknown[]) => ({ sql, args }),
            }),
            batch,
        } as unknown as D1Database,
    })
    return { env, batch }
}

describe('parseHostedRuntimeContainerName', () => {
    it('round-trips the canonical container name back to the room identity', () => {
        const name = hostedRuntimeContainerName({
            workspaceId: 'workspace_1',
            roomId: 'room_1',
        })
        expect(parseHostedRuntimeContainerName(name)).toEqual({
            workspaceId: 'workspace_1',
            roomId: 'room_1',
        })
    })

    it('rejects names that are not canonical room identities', () => {
        expect(parseHostedRuntimeContainerName(undefined)).toBeNull()
        expect(parseHostedRuntimeContainerName('')).toBeNull()
        expect(parseHostedRuntimeContainerName('workspace:a:room:')).toBeNull()
        expect(parseHostedRuntimeContainerName('workspace::room:b')).toBeNull()
        expect(parseHostedRuntimeContainerName('rooms/a/b')).toBeNull()
        expect(parseHostedRuntimeContainerName('workspace:a:room:b:extra')).toBeNull()
    })
})

describe('handleHostedRuntimeContainerStop', () => {
    it('persists the stopped transition when the room was running, so slept rooms free the concurrent cap', async () => {
        const { env, batch } = batchEnv({ batchChanges: [1, 1] })
        const outcome = await handleHostedRuntimeContainerStop({
            env,
            containerName: 'workspace:workspace_1:room:room_1',
            stop: stopParams(),
        })
        expect(outcome).toBe('transitioned')
        expect(batch).toHaveBeenCalledTimes(1)
    })

    it('reports a no-op when the room already left running status, so restarts and pauses are not clobbered', async () => {
        const { env } = batchEnv({ batchChanges: [0, 0] })
        const outcome = await handleHostedRuntimeContainerStop({
            env,
            containerName: 'workspace:workspace_1:room:room_1',
            stop: stopParams(),
        })
        expect(outcome).toBe('noop')
    })

    it('does not touch the database when the container name is not a canonical room identity', async () => {
        const { env, batch } = batchEnv({ batchChanges: [1, 1] })
        const outcome = await handleHostedRuntimeContainerStop({
            env,
            containerName: 'not-a-room-container',
            stop: stopParams(),
        })
        expect(outcome).toBe('unparseable')
        expect(batch).not.toHaveBeenCalled()
    })

    it('swallows and logs persistence failures so the durable object never crashes on stop, leaving the room counted as active', async () => {
        const { env } = batchEnv({ batchError: new Error('D1 unavailable') })
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
        const outcome = await handleHostedRuntimeContainerStop({
            env,
            containerName: 'workspace:workspace_1:room:room_1',
            stop: stopParams(),
        })
        errorSpy.mockRestore()
        expect(outcome).toBe('failed')
    })
})
