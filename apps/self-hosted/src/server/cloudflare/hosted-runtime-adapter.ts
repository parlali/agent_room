import type { AgentRoomHostedEnv, AgentRoomRuntimeJobMessage } from './bindings'
import { resolveHostedConfig } from './hosted-config'
import {
    buildHostedRuntimeStartOptions,
    hostedRuntimeContainerName,
    hostedRuntimeContainerPort,
} from './runtime-contract'

export const hostedRuntimeConfigPath = '/workspace/runtime/pi-runtime.config.json'

interface HostedRuntimeRow {
    roomId: string
    workspaceId: string
    desiredState: string
    containerName: string
    configObjectKey: string | null
    workspaceSnapshotKey: string | null
}

interface HostedRuntimeObjectStore {
    head: (key: string) => Promise<unknown | null>
}

function truncateRuntimeError(error: unknown): string {
    const message = error instanceof Error ? error.message : String(error)
    return message.slice(0, 2000)
}

async function writeRuntimeFailure(input: {
    env: AgentRoomHostedEnv
    workspaceId: string
    roomId: string
    error: unknown
}): Promise<void> {
    const now = new Date().toISOString()
    const lastError = truncateRuntimeError(input.error)
    await input.env.AGENT_ROOM_DB.prepare(
        `
            UPDATE hosted_room_runtime_state
            SET health_status = 'unhealthy',
                last_error = ?1,
                updated_at = ?2
            WHERE room_id = ?3
              AND workspace_id = ?4
        `,
    )
        .bind(lastError, now, input.roomId, input.workspaceId)
        .run()
    await input.env.AGENT_ROOM_DB.prepare(
        `
            UPDATE hosted_room
            SET status = 'failed',
                updated_at = ?1
            WHERE id = ?2
              AND workspace_id = ?3
        `,
    )
        .bind(now, input.roomId, input.workspaceId)
        .run()
}

async function readHostedRuntimeRow(
    env: AgentRoomHostedEnv,
    message: AgentRoomRuntimeJobMessage,
): Promise<HostedRuntimeRow> {
    const row = await env.AGENT_ROOM_DB.prepare(
        `
            SELECT
                room.id AS roomId,
                room.workspace_id AS workspaceId,
                room.desired_state AS desiredState,
                runtime.container_name AS containerName,
                runtime.config_object_key AS configObjectKey,
                runtime.workspace_snapshot_key AS workspaceSnapshotKey
            FROM hosted_room AS room
            INNER JOIN hosted_room_runtime_state AS runtime
                ON runtime.room_id = room.id
               AND runtime.workspace_id = room.workspace_id
            WHERE room.id = ?1
              AND room.workspace_id = ?2
            LIMIT 1
        `,
    )
        .bind(message.roomId, message.workspaceId)
        .first<HostedRuntimeRow>()

    if (!row) {
        throw new Error('Hosted runtime state was not found for requested room')
    }
    return row
}

async function assertObjectExists(input: {
    bucket: HostedRuntimeObjectStore
    key: string
    label: string
}): Promise<void> {
    const object = await input.bucket.head(input.key)
    if (!object) {
        throw new Error(`${input.label} object ${input.key} was not found in R2`)
    }
}

async function markRuntimeStarting(input: {
    env: AgentRoomHostedEnv
    workspaceId: string
    roomId: string
}): Promise<void> {
    const now = new Date().toISOString()
    await input.env.AGENT_ROOM_DB.prepare(
        `
            UPDATE hosted_room
            SET status = 'starting',
                updated_at = ?1
            WHERE id = ?2
              AND workspace_id = ?3
        `,
    )
        .bind(now, input.roomId, input.workspaceId)
        .run()
    await input.env.AGENT_ROOM_DB.prepare(
        `
            UPDATE hosted_room_runtime_state
            SET health_status = 'unknown',
                last_error = NULL,
                updated_at = ?1
            WHERE room_id = ?2
              AND workspace_id = ?3
        `,
    )
        .bind(now, input.roomId, input.workspaceId)
        .run()
}

async function markRuntimeRunning(input: {
    env: AgentRoomHostedEnv
    workspaceId: string
    roomId: string
}): Promise<void> {
    const now = new Date().toISOString()
    await input.env.AGENT_ROOM_DB.prepare(
        `
            UPDATE hosted_room_runtime_state
            SET health_status = 'healthy',
                started_at = COALESCE(started_at, ?1),
                last_health_at = ?1,
                updated_at = ?1
            WHERE room_id = ?2
              AND workspace_id = ?3
        `,
    )
        .bind(now, input.roomId, input.workspaceId)
        .run()
    await input.env.AGENT_ROOM_DB.prepare(
        `
            UPDATE hosted_room
            SET status = 'running',
                updated_at = ?1
            WHERE id = ?2
              AND workspace_id = ?3
        `,
    )
        .bind(now, input.roomId, input.workspaceId)
        .run()
}

export async function reconcileHostedRuntimeJob(
    env: AgentRoomHostedEnv,
    message: AgentRoomRuntimeJobMessage,
): Promise<void> {
    if (message.kind !== 'room-runtime-reconcile') {
        throw new Error(`Unsupported hosted runtime job kind ${message.kind}`)
    }

    const runtime = await readHostedRuntimeRow(env, message)
    if (runtime.desiredState !== 'running') {
        return
    }

    try {
        const expectedContainerName = hostedRuntimeContainerName({
            workspaceId: runtime.workspaceId,
            roomId: runtime.roomId,
        })
        if (runtime.containerName !== expectedContainerName) {
            throw new Error(
                'Hosted runtime state container name does not match canonical room identity',
            )
        }
        if (!runtime.configObjectKey) {
            throw new Error(
                'Hosted runtime config object key is required before starting a container',
            )
        }

        await assertObjectExists({
            bucket: env.AGENT_ROOM_WORKSPACE_BUCKET,
            key: runtime.configObjectKey,
            label: 'Runtime config',
        })
        if (runtime.workspaceSnapshotKey) {
            await assertObjectExists({
                bucket: env.AGENT_ROOM_WORKSPACE_BUCKET,
                key: runtime.workspaceSnapshotKey,
                label: 'Workspace snapshot',
            })
        }

        await markRuntimeStarting({
            env,
            workspaceId: runtime.workspaceId,
            roomId: runtime.roomId,
        })

        const config = resolveHostedConfig(env)
        const startOptions = buildHostedRuntimeStartOptions({
            workspaceId: runtime.workspaceId,
            roomId: runtime.roomId,
            runtimeConfigPath: hostedRuntimeConfigPath,
            runtimeToken: crypto.randomUUID(),
            controlPlaneOrigin: config.publicOrigin,
        })
        const container = env.AGENT_ROOM_RUNTIME.getByName(runtime.containerName)
        await container.startAndWaitForPorts({
            ports: hostedRuntimeContainerPort,
            startOptions,
            cancellationOptions: {
                instanceGetTimeoutMS: 10000,
                portReadyTimeoutMS: 10000,
                waitInterval: 250,
            },
        })
        await markRuntimeRunning({
            env,
            workspaceId: runtime.workspaceId,
            roomId: runtime.roomId,
        })
    } catch (error) {
        await writeRuntimeFailure({
            env,
            workspaceId: runtime.workspaceId,
            roomId: runtime.roomId,
            error,
        })
        throw error
    }
}
