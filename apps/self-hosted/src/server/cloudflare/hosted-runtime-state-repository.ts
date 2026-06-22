import type { HealthStatus, RoomStatus } from '../../domain/domain-types'
import type { AgentRoomHostedEnv } from './bindings'

type HostedRuntimeRoomStatus = Extract<RoomStatus, 'starting' | 'running' | 'failed'>
type HostedRuntimeHealthStatus = Extract<HealthStatus, 'unknown' | 'healthy' | 'unhealthy'>

export type HostedRuntimeStateTransition =
    | { kind: 'starting' }
    | { kind: 'running' }
    | { kind: 'failed'; error: unknown }

interface HostedRuntimeStateTransitionInput {
    env: AgentRoomHostedEnv
    workspaceId: string
    roomId: string
    transition: HostedRuntimeStateTransition
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
}): void {
    const failedIndex = input.results.findIndex(
        (result) => typeof result.meta?.changes !== 'number' || result.meta.changes < 1,
    )
    if (failedIndex !== -1) {
        throw new Error(
            `Hosted runtime state transition did not update statement ${failedIndex + 1} for workspace ${input.workspaceId} room ${input.roomId}`,
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
}): Promise<void> {
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
            `,
        ).bind(input.roomStatus, input.now, input.roomId, input.workspaceId),
    ])
    assertRuntimeStateBatchChanged({
        results,
        workspaceId: input.workspaceId,
        roomId: input.roomId,
    })
}

export async function countActiveHostedRuntimesForWorkspace(input: {
    env: AgentRoomHostedEnv
    workspaceId: string
    excludeRoomId: string
}): Promise<number> {
    const row = await input.env.AGENT_ROOM_DB.prepare(
        `
            SELECT COUNT(*) AS activeCount
            FROM hosted_room
            WHERE workspace_id = ?1
              AND status IN ('starting', 'running')
              AND id != ?2
        `,
    )
        .bind(input.workspaceId, input.excludeRoomId)
        .first<{ activeCount: number }>()
    return row?.activeCount ?? 0
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
    })
}
