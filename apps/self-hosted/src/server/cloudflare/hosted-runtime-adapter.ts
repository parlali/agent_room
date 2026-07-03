import { piRuntimeBootMaterializePath } from '../rooms/pi-runtime-contract'
import type { AgentRoomHostedEnv, AgentRoomRuntimeJobMessage } from './bindings'
import { assertHostedQuotaAllowed } from './hosted-abuse-controls'
import { hostedRuntimeReadConcurrency, mapWithConcurrency } from './hosted-concurrency'
import {
    evaluateHostedRuntimeAccess,
    hostedRuntimeAccessDeniedMessage,
} from './hosted-runtime-access'
import {
    failClosedHostedRuntime,
    HostedRuntimeMaterializationConflictError,
    materializeHostedRuntime,
    stopHostedRuntime,
} from './hosted-room-service'
import {
    listHostedRoomFileMaterializations,
    type HostedRoomFileMaterialization,
} from './hosted-file-read-store'
import type { RuntimeFileBundleEntry } from './hosted-runtime-materialization'
import {
    HostedRuntimeDesiredStateChangedError,
    writeHostedRuntimeStateTransition,
} from './hosted-runtime-state-repository'
import {
    buildHostedRuntimeStartOptions,
    hostedRuntimeDeniedHosts,
    hostedRuntimeContainerName,
    hostedRuntimeContainerPort,
    hostedRuntimeStartCancellation,
    type HostedRuntimeContainerStub,
} from './runtime-contract'
import { hostedRuntimeConfigPath } from './hosted-runtime-paths'

export { hostedRuntimeConfigPath }

interface HostedRuntimeRow {
    roomId: string
    workspaceId: string
    desiredState: string
    containerName: string
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

async function assertHostedRuntimeStillDesiredRunning(
    env: AgentRoomHostedEnv,
    runtime: Pick<HostedRuntimeRow, 'workspaceId' | 'roomId'>,
): Promise<void> {
    const row = await env.AGENT_ROOM_DB.prepare(
        `
            SELECT desired_state AS desiredState
            FROM hosted_room
            WHERE workspace_id = ?1
              AND id = ?2
            LIMIT 1
        `,
    )
        .bind(runtime.workspaceId, runtime.roomId)
        .first<{ desiredState: string }>()
    if (row?.desiredState !== 'running') {
        throw new HostedRuntimeDesiredStateChangedError()
    }
}

async function pushHostedRuntimeBootBundle(input: {
    container: HostedRuntimeContainerStub
    token: string
    bundle: RuntimeFileBundleEntry[]
}): Promise<void> {
    const response = await input.container.fetch(
        new Request(`http://agent-room-runtime${piRuntimeBootMaterializePath}`, {
            method: 'POST',
            headers: {
                authorization: `Bearer ${input.token}`,
                'content-type': 'application/json',
            },
            body: JSON.stringify(input.bundle),
        }),
    )
    if (!response.ok) {
        throw new Error(`Hosted runtime boot hydration failed with status ${response.status}`)
    }
}

async function hydrateHostedRuntimeFiles(input: {
    container: HostedRuntimeContainerStub
    token: string
    files: HostedRoomFileMaterialization[]
}): Promise<void> {
    await mapWithConcurrency(input.files, hostedRuntimeReadConcurrency, async (file) => {
        const response = await input.container.fetch(
            new Request('http://agent-room-runtime/files/materialize', {
                method: 'POST',
                headers: {
                    authorization: `Bearer ${input.token}`,
                    'content-type': 'application/json',
                },
                body: JSON.stringify(file),
            }),
        )
        if (!response.ok) {
            throw new Error(`Hosted runtime file hydration failed with status ${response.status}`)
        }
    })
}

export function isHostedRuntimeDownError(error: unknown): boolean {
    const message = error instanceof Error ? error.message : ''
    return /not running|not healthy|not active|consider calling start/i.test(message)
}

export async function withHostedRuntimeStarted<T>(input: {
    env: AgentRoomHostedEnv
    workspaceId: string
    roomId: string
    actorUserId?: string | null
    run: () => Promise<T>
}): Promise<T> {
    try {
        return await input.run()
    } catch (error) {
        if (!isHostedRuntimeDownError(error)) {
            throw error
        }
        await reconcileHostedRuntimeJob(input.env, {
            kind: 'room-runtime-reconcile',
            workspaceId: input.workspaceId,
            roomId: input.roomId,
            actorUserId: input.actorUserId ?? null,
            requestedAt: new Date().toISOString(),
        })
        return input.run()
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
        const access = await evaluateHostedRuntimeAccess({
            env,
            workspaceId: runtime.workspaceId,
            roomId: runtime.roomId,
        })
        if (!access.allowed) {
            const reasonMessage = hostedRuntimeAccessDeniedMessage(access.reason)
            console.error(reasonMessage, { reason: access.reason })
            await failClosedHostedRuntime({
                env,
                workspaceId: runtime.workspaceId,
                roomId: runtime.roomId,
                error: new Error(reasonMessage),
            })
            return
        }
        const expectedContainerName = hostedRuntimeContainerName({
            workspaceId: runtime.workspaceId,
            roomId: runtime.roomId,
        })
        if (runtime.containerName !== expectedContainerName) {
            throw new Error(
                'Hosted runtime state container name does not match canonical room identity',
            )
        }

        const materialization = await materializeHostedRuntime({
            env,
            actor: {
                workspaceId: runtime.workspaceId,
                userId: message.actorUserId ?? 'system',
            },
            roomId: runtime.roomId,
        })

        if (
            !materialization.configObjectKey ||
            !materialization.tokenObjectKey ||
            !materialization.bundleObjectKey
        ) {
            throw new Error('Hosted runtime objects are required before starting a container')
        }

        const requiredObjects = [
            { key: materialization.configObjectKey, label: 'Runtime config' },
            { key: materialization.tokenObjectKey, label: 'Runtime token' },
            { key: materialization.bundleObjectKey, label: 'Runtime boot bundle' },
            ...(runtime.workspaceSnapshotKey
                ? [{ key: runtime.workspaceSnapshotKey, label: 'Workspace snapshot' }]
                : []),
        ]
        await Promise.all(
            requiredObjects.map((object) =>
                assertObjectExists({
                    bucket: env.AGENT_ROOM_WORKSPACE_BUCKET,
                    key: object.key,
                    label: object.label,
                }),
            ),
        )

        await writeHostedRuntimeStateTransition({
            env,
            workspaceId: runtime.workspaceId,
            roomId: runtime.roomId,
            transition: {
                kind: 'starting',
            },
            requireDesiredRunning: true,
        })

        const startOptions = buildHostedRuntimeStartOptions({
            workspaceId: runtime.workspaceId,
            roomId: runtime.roomId,
            runtimeConfigPath: hostedRuntimeConfigPath,
            runtimeToken: materialization.runtimeEnv.AGENT_ROOM_PI_RUNTIME_TOKEN,
            envVars: materialization.runtimeEnv,
        })
        const container = env.AGENT_ROOM_RUNTIME.getByName(runtime.containerName)
        await assertHostedRuntimeStillDesiredRunning(env, runtime)
        await assertHostedQuotaAllowed({
            env,
            workspaceId: runtime.workspaceId,
            roomId: runtime.roomId,
            action: 'runtime_start',
            amount: {
                count: 1,
            },
        })
        const roomFilesPromise = listHostedRoomFileMaterializations({
            env,
            workspaceId: runtime.workspaceId,
            roomId: runtime.roomId,
        })
        roomFilesPromise.catch(() => undefined)
        await container.startAndWaitForPorts({
            ports: hostedRuntimeContainerPort,
            startOptions,
            cancellationOptions: hostedRuntimeStartCancellation,
        })
        await Promise.all([
            container.setAllowedHosts(materialization.egressAllowedHosts),
            container.setDeniedHosts(hostedRuntimeDeniedHosts),
        ])
        await pushHostedRuntimeBootBundle({
            container,
            token: materialization.runtimeEnv.AGENT_ROOM_PI_RUNTIME_TOKEN,
            bundle: materialization.bundle,
        })
        await hydrateHostedRuntimeFiles({
            container,
            token: materialization.runtimeEnv.AGENT_ROOM_PI_RUNTIME_TOKEN,
            files: await roomFilesPromise,
        })
        await writeHostedRuntimeStateTransition({
            env,
            workspaceId: runtime.workspaceId,
            roomId: runtime.roomId,
            transition: {
                kind: 'running',
            },
            requireDesiredRunning: true,
        })
    } catch (error) {
        if (error instanceof HostedRuntimeMaterializationConflictError) {
            console.warn('Hosted runtime reconcile skipped because materialization was superseded')
            return
        }
        if (error instanceof HostedRuntimeDesiredStateChangedError) {
            console.warn('Hosted runtime reconcile skipped because room desired state changed')
            await stopHostedRuntime({
                env,
                workspaceId: runtime.workspaceId,
                roomId: runtime.roomId,
            })
            return
        }
        await failClosedHostedRuntime({
            env,
            workspaceId: runtime.workspaceId,
            roomId: runtime.roomId,
            error,
        })
        throw error
    }
}
