import type { AgentRoomHostedEnv, AgentRoomRuntimeJobMessage } from './bindings'
import { resolveHostedConfig } from './hosted-config'
import { writeHostedRuntimeStateTransition } from './hosted-runtime-state-repository'
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

        await writeHostedRuntimeStateTransition({
            env,
            workspaceId: runtime.workspaceId,
            roomId: runtime.roomId,
            transition: {
                kind: 'starting',
            },
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
        await writeHostedRuntimeStateTransition({
            env,
            workspaceId: runtime.workspaceId,
            roomId: runtime.roomId,
            transition: {
                kind: 'running',
            },
        })
    } catch (error) {
        await writeHostedRuntimeStateTransition({
            env,
            workspaceId: runtime.workspaceId,
            roomId: runtime.roomId,
            transition: {
                kind: 'failed',
                error,
            },
        })
        throw error
    }
}
