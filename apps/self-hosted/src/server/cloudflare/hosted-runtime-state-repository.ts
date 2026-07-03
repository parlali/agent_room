import type { HealthStatus, RoomStatus } from '../../domain/domain-types'
import type { AgentRoomHostedEnv } from './bindings'

type HostedRuntimeRoomStatus = Extract<RoomStatus, 'starting' | 'running' | 'failed'>
type HostedRuntimeHealthStatus = Extract<HealthStatus, 'unknown' | 'healthy' | 'unhealthy'>

export type HostedRuntimeStateTransition =
    | { kind: 'starting' }
    | { kind: 'running' }
    | { kind: 'failed'; error: unknown }

export class HostedRuntimeDesiredStateChangedError extends Error {
    constructor() {
        super('Hosted runtime desired state changed before transition')
        this.name = 'HostedRuntimeDesiredStateChangedError'
    }
}

interface HostedRuntimeStateTransitionInput {
    env: AgentRoomHostedEnv
    workspaceId: string
    roomId: string
    transition: HostedRuntimeStateTransition
    requireDesiredRunning?: boolean
    now?: string
}

interface RuntimeStateBatchResult {
    meta?: {
        changes?: number
    }
}

function truncateRuntimeError(error: unknown): string {
    const message = error instanceof Error ? error.message : String(error)
    return message.slice(0, 2000)
}

function assertRuntimeStateBatchChanged(input: {
    results: RuntimeStateBatchResult[]
    workspaceId: string
    roomId: string
    requireDesiredRunning: boolean
}): void {
    const failedIndex = input.results.findIndex(
        (result) => typeof result.meta?.changes !== 'number' || result.meta.changes < 1,
    )
    if (failedIndex !== -1) {
        if (input.requireDesiredRunning) {
            throw new HostedRuntimeDesiredStateChangedError()
        }
        throw new Error(
            `Hosted runtime state transition did not update statement ${failedIndex + 1}`,
        )
    }
}

async function batchRuntimeState(input: {
    env: AgentRoomHostedEnv
    workspaceId: string
    roomId: string
    roomStatus: HostedRuntimeRoomStatus
    healthStatus: HostedRuntimeHealthStatus
    now: string
    lastError: string | null
    markStarted: boolean
    markHealthy: boolean
    requireDesiredRunning: boolean
}): Promise<void> {
    const runtimeDesiredStatePredicate = input.requireDesiredRunning
        ? `
                  AND EXISTS (
                      SELECT 1
                      FROM hosted_room
                      WHERE hosted_room.workspace_id = hosted_room_runtime_state.workspace_id
                        AND hosted_room.id = hosted_room_runtime_state.room_id
                        AND hosted_room.desired_state = 'running'
                  )
          `
        : ''
    const roomDesiredStatePredicate = input.requireDesiredRunning
        ? `
                  AND desired_state = 'running'
          `
        : ''
    const runtimeStatement = input.markStarted
        ? input.env.AGENT_ROOM_DB.prepare(
              `
                  UPDATE hosted_room_runtime_state
                  SET health_status = ?1,
                      started_at = COALESCE(started_at, ?2),
                      last_health_at = ?2,
                      last_error = NULL,
                      updated_at = ?2
                  WHERE room_id = ?3
                    AND workspace_id = ?4
                    ${runtimeDesiredStatePredicate}
              `,
          ).bind(input.healthStatus, input.now, input.roomId, input.workspaceId)
        : input.env.AGENT_ROOM_DB.prepare(
              `
                  UPDATE hosted_room_runtime_state
                  SET health_status = ?1,
                      last_health_at = CASE WHEN ?2 THEN ?3 ELSE last_health_at END,
                      last_error = ?4,
                      updated_at = ?3
                  WHERE room_id = ?5
                    AND workspace_id = ?6
                    ${runtimeDesiredStatePredicate}
              `,
          ).bind(
              input.healthStatus,
              input.markHealthy ? 1 : 0,
              input.now,
              input.lastError,
              input.roomId,
              input.workspaceId,
          )

    const results = await input.env.AGENT_ROOM_DB.batch([
        runtimeStatement,
        input.env.AGENT_ROOM_DB.prepare(
            `
                UPDATE hosted_room
                SET status = ?1,
                    updated_at = ?2
                WHERE id = ?3
                  AND workspace_id = ?4
                  ${roomDesiredStatePredicate}
            `,
        ).bind(input.roomStatus, input.now, input.roomId, input.workspaceId),
    ])
    assertRuntimeStateBatchChanged({
        results,
        workspaceId: input.workspaceId,
        roomId: input.roomId,
        requireDesiredRunning: input.requireDesiredRunning,
    })
}

export const hostedRuntimeStartingActiveWindowMs = 15 * 60 * 1000

export async function countActiveHostedRuntimesForWorkspace(input: {
    env: AgentRoomHostedEnv
    workspaceId: string
    excludeRoomId: string
    now?: Date
}): Promise<number> {
    const startingActiveCutoff = new Date(
        (input.now ?? new Date()).getTime() - hostedRuntimeStartingActiveWindowMs,
    ).toISOString()
    const row = await input.env.AGENT_ROOM_DB.prepare(
        `
            SELECT COUNT(*) AS activeCount
            FROM hosted_room
            WHERE workspace_id = ?1
              AND id != ?2
              AND (
                  status = 'running'
                  OR (status = 'starting' AND updated_at >= ?3)
              )
        `,
    )
        .bind(input.workspaceId, input.excludeRoomId, startingActiveCutoff)
        .first<{ activeCount: number }>()
    return row?.activeCount ?? 0
}

export async function markHostedRuntimeContainerStopped(input: {
    env: AgentRoomHostedEnv
    workspaceId: string
    roomId: string
    now?: string
}): Promise<boolean> {
    const now = input.now ?? new Date().toISOString()
    const results = await input.env.AGENT_ROOM_DB.batch([
        input.env.AGENT_ROOM_DB.prepare(
            `
                UPDATE hosted_room_runtime_state
                SET health_status = 'unknown',
                    updated_at = ?1
                WHERE workspace_id = ?2
                  AND room_id = ?3
                  AND EXISTS (
                      SELECT 1
                      FROM hosted_room
                      WHERE hosted_room.workspace_id = hosted_room_runtime_state.workspace_id
                        AND hosted_room.id = hosted_room_runtime_state.room_id
                        AND hosted_room.status = 'running'
                  )
            `,
        ).bind(now, input.workspaceId, input.roomId),
        input.env.AGENT_ROOM_DB.prepare(
            `
                UPDATE hosted_room
                SET status = 'stopped',
                    updated_at = ?1
                WHERE workspace_id = ?2
                  AND id = ?3
                  AND status = 'running'
            `,
        ).bind(now, input.workspaceId, input.roomId),
    ])
    const roomResult = results[1] as RuntimeStateBatchResult | undefined
    return typeof roomResult?.meta?.changes === 'number' && roomResult.meta.changes > 0
}

export async function writeHostedRuntimeStateTransition(
    input: HostedRuntimeStateTransitionInput,
): Promise<void> {
    const now = input.now ?? new Date().toISOString()

    if (input.transition.kind === 'starting') {
        await batchRuntimeState({
            env: input.env,
            workspaceId: input.workspaceId,
            roomId: input.roomId,
            roomStatus: 'starting',
            healthStatus: 'unknown',
            now,
            lastError: null,
            markStarted: false,
            markHealthy: false,
            requireDesiredRunning: input.requireDesiredRunning ?? false,
        })
        return
    }

    if (input.transition.kind === 'running') {
        await batchRuntimeState({
            env: input.env,
            workspaceId: input.workspaceId,
            roomId: input.roomId,
            roomStatus: 'running',
            healthStatus: 'healthy',
            now,
            lastError: null,
            markStarted: true,
            markHealthy: true,
            requireDesiredRunning: input.requireDesiredRunning ?? false,
        })
        return
    }

    await batchRuntimeState({
        env: input.env,
        workspaceId: input.workspaceId,
        roomId: input.roomId,
        roomStatus: 'failed',
        healthStatus: 'unhealthy',
        now,
        lastError: truncateRuntimeError(input.transition.error),
        markStarted: false,
        markHealthy: false,
        requireDesiredRunning: input.requireDesiredRunning ?? false,
    })
}
