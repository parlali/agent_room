import { piRuntimeBootMaterializePath, piRuntimeBootReadyPath } from '../rooms/pi-runtime-contract'
import type { AgentRoomHostedEnv, AgentRoomRuntimeJobMessage } from './bindings'
import { assertHostedQuotaAllowed } from './hosted-abuse-controls'
import { hostedRuntimeReadConcurrency, mapWithConcurrency } from './hosted-concurrency'
import {
    evaluateHostedRuntimeAccess,
    hostedRuntimeAccessDeniedMessage,
} from './hosted-runtime-access'
import {
    failClosedHostedRuntime,
    getHostedRoom,
    getHostedRuntimeEndpointState,
    HostedRuntimeMaterializationConflictError,
    materializeHostedRuntime,
    setHostedRoomDesiredState,
    stopHostedRuntime,
} from './hosted-room-service'
import { readHostedRuntimeToken } from './hosted-runtime-artifacts'
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
    hostedRuntimeRecreateStartPortReadyTimeoutMS,
    hostedRuntimeStartCancellation,
    hostedRuntimeTeardownConfirmTimeoutMS,
    hostedRuntimeTeardownProgressLogIntervalMS,
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

export class HostedRuntimeBootUnauthorizedError extends Error {
    constructor() {
        super('Hosted runtime boot rejected the runtime token as stale')
        this.name = 'HostedRuntimeBootUnauthorizedError'
    }
}

export class HostedRuntimeRecreateDeferredError extends Error {
    constructor(message: string, options?: { cause?: unknown }) {
        super(message, options)
        this.name = 'HostedRuntimeRecreateDeferredError'
    }
}

interface HostedRuntimeReconcileDelivery {
    attempt: number
    maxAttempts: number
}

type HostedRuntimeReadiness = 'ready' | 'booting' | 'unauthorized'

type HostedRuntimeBootOutcome = 'already-ready' | 'delivered'

function delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
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
    if (response.status === 401) {
        throw new HostedRuntimeBootUnauthorizedError()
    }
    if (response.status === 409) {
        return
    }
    if (!response.ok) {
        throw new Error(`Hosted runtime boot hydration failed with status ${response.status}`)
    }
}

async function probeHostedRuntimeReady(input: {
    container: HostedRuntimeContainerStub
    token: string
}): Promise<HostedRuntimeReadiness> {
    const response = await input.container.fetch(
        new Request(`http://agent-room-runtime${piRuntimeBootReadyPath}`, {
            method: 'GET',
            headers: {
                authorization: `Bearer ${input.token}`,
            },
        }),
    )
    if (response.status === 200) {
        return 'ready'
    }
    if (response.status === 401) {
        return 'unauthorized'
    }
    return 'booting'
}

export async function waitForHostedRuntimeReady(input: {
    container: HostedRuntimeContainerStub
    token: string
    timeoutMs: number
    intervalMs: number
}): Promise<void> {
    const deadline = Date.now() + input.timeoutMs
    for (;;) {
        const readiness = await probeHostedRuntimeReady({
            container: input.container,
            token: input.token,
        })
        if (readiness === 'ready') {
            return
        }
        if (readiness === 'unauthorized') {
            throw new HostedRuntimeBootUnauthorizedError()
        }
        if (Date.now() >= deadline) {
            throw new Error('Hosted runtime did not become ready before the start timeout')
        }
        await delay(input.intervalMs)
    }
}

export async function confirmHostedRuntimeContainerStopped(input: {
    container: HostedRuntimeContainerStub
    timeoutMs: number
    intervalMs: number
}): Promise<void> {
    const startedAt = Date.now()
    const deadline = startedAt + input.timeoutMs
    let lastProgressLog = 0
    for (;;) {
        const state = await input.container.getState()
        if (state.status !== 'running' && state.status !== 'healthy') {
            return
        }
        const now = Date.now()
        const elapsedSeconds = Math.round((now - startedAt) / 1000)
        if (now >= deadline) {
            throw new HostedRuntimeRecreateDeferredError(
                `Hosted runtime container was still ${state.status} ${elapsedSeconds}s after destroy; deferring recreate to a queue retry`,
            )
        }
        if (now - lastProgressLog >= hostedRuntimeTeardownProgressLogIntervalMS) {
            console.warn(
                `Hosted runtime container still ${state.status} ${elapsedSeconds}s after destroy; waiting for teardown before recreate`,
            )
            lastProgressLog = now
        }
        await delay(input.intervalMs)
    }
}

type HostedRuntimeBootDelivery = 'ready' | 'delivered' | 'stale'

async function deliverHostedRuntimeBoot(input: {
    container: HostedRuntimeContainerStub
    token: string
    bundle: RuntimeFileBundleEntry[]
}): Promise<HostedRuntimeBootDelivery> {
    const readiness = await probeHostedRuntimeReady({
        container: input.container,
        token: input.token,
    })
    if (readiness === 'ready') {
        return 'ready'
    }
    if (readiness === 'booting') {
        try {
            await pushHostedRuntimeBootBundle({
                container: input.container,
                token: input.token,
                bundle: input.bundle,
            })
            return 'delivered'
        } catch (error) {
            if (!(error instanceof HostedRuntimeBootUnauthorizedError)) {
                throw error
            }
        }
    }
    return 'stale'
}

async function ensureHostedRuntimeBootDelivered(input: {
    container: HostedRuntimeContainerStub
    token: string
    bundle: RuntimeFileBundleEntry[]
    startContainer: (portReadyTimeoutMs: number) => Promise<void>
}): Promise<HostedRuntimeBootOutcome> {
    await input.startContainer(hostedRuntimeStartCancellation.portReadyTimeoutMS)
    const first = await deliverHostedRuntimeBoot({
        container: input.container,
        token: input.token,
        bundle: input.bundle,
    })
    if (first === 'ready') {
        return 'already-ready'
    }
    if (first === 'delivered') {
        return 'delivered'
    }

    console.warn('Hosted runtime boot token is stale for the running container; recreating it once')
    await input.container.destroy()
    await confirmHostedRuntimeContainerStopped({
        container: input.container,
        timeoutMs: hostedRuntimeTeardownConfirmTimeoutMS,
        intervalMs: hostedRuntimeStartCancellation.waitInterval,
    })
    try {
        await input.startContainer(hostedRuntimeRecreateStartPortReadyTimeoutMS)
    } catch (error) {
        throw new HostedRuntimeRecreateDeferredError(
            'Hosted runtime recreate did not bind ports within the bounded restart window; deferring to a queue retry',
            { cause: error },
        )
    }
    const second = await deliverHostedRuntimeBoot({
        container: input.container,
        token: input.token,
        bundle: input.bundle,
    })
    if (second === 'ready') {
        return 'already-ready'
    }
    if (second === 'delivered') {
        return 'delivered'
    }
    throw new HostedRuntimeBootUnauthorizedError()
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

async function resumeStoppedHostedRoomForUserSend(input: {
    env: AgentRoomHostedEnv
    workspaceId: string
    roomId: string
    actorUserId: string
}): Promise<void> {
    const room = await getHostedRoom({
        env: input.env,
        workspaceId: input.workspaceId,
        roomId: input.roomId,
    })
    if (!room || room.desiredState !== 'stopped') {
        return
    }
    console.warn(
        'Hosted room resume requested because an authenticated user sent a message while paused',
    )
    await setHostedRoomDesiredState({
        env: input.env,
        actor: {
            workspaceId: input.workspaceId,
            userId: input.actorUserId,
        },
        roomId: input.roomId,
        desiredState: 'running',
    })
}

export async function withHostedRuntimeStarted<T>(input: {
    env: AgentRoomHostedEnv
    workspaceId: string
    roomId: string
    actorUserId?: string | null
    autoResume?: boolean
    run: () => Promise<T>
}): Promise<T> {
    try {
        return await input.run()
    } catch (error) {
        if (!isHostedRuntimeDownError(error)) {
            throw error
        }
        if (input.autoResume && input.actorUserId) {
            await resumeStoppedHostedRoomForUserSend({
                env: input.env,
                workspaceId: input.workspaceId,
                roomId: input.roomId,
                actorUserId: input.actorUserId,
            })
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

export async function convergeHostedRuntimeHealthIfReady(input: {
    env: AgentRoomHostedEnv
    workspaceId: string
    roomId: string
}): Promise<boolean> {
    const endpoint = await getHostedRuntimeEndpointState(input)
    if (!endpoint) {
        return false
    }
    if (endpoint.desiredState !== 'running' || endpoint.status === 'stopped') {
        return false
    }
    if (!endpoint.runtime.tokenObjectKey) {
        return false
    }
    const container = input.env.AGENT_ROOM_RUNTIME.getByName(endpoint.runtime.containerName)
    const state = await container.getState()
    if (state.status !== 'running' && state.status !== 'healthy') {
        return false
    }
    const token = await readHostedRuntimeToken({
        env: input.env,
        tokenObjectKey: endpoint.runtime.tokenObjectKey,
    })
    const readiness = await probeHostedRuntimeReady({ container, token })
    if (readiness !== 'ready') {
        return false
    }
    try {
        await writeHostedRuntimeStateTransition({
            env: input.env,
            workspaceId: input.workspaceId,
            roomId: input.roomId,
            transition: {
                kind: 'running',
            },
            requireDesiredRunning: true,
        })
    } catch (error) {
        if (error instanceof HostedRuntimeDesiredStateChangedError) {
            return false
        }
        throw error
    }
    return true
}

export async function reconcileHostedRuntimeJob(
    env: AgentRoomHostedEnv,
    message: AgentRoomRuntimeJobMessage,
    delivery?: HostedRuntimeReconcileDelivery,
): Promise<void> {
    if (message.kind !== 'room-runtime-reconcile') {
        throw new Error(`Unsupported hosted runtime job kind ${message.kind}`)
    }
    const recreateDeferralRetryable =
        delivery !== undefined && delivery.attempt < delivery.maxAttempts

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
            rotateToken: message.rotateToken ?? false,
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
        const runtimeToken = materialization.runtimeEnv.AGENT_ROOM_PI_RUNTIME_TOKEN
        const outcome = await ensureHostedRuntimeBootDelivered({
            container,
            token: runtimeToken,
            bundle: materialization.bundle,
            startContainer: async (portReadyTimeoutMs: number) => {
                await container.startAndWaitForPorts({
                    ports: hostedRuntimeContainerPort,
                    startOptions,
                    cancellationOptions: {
                        ...hostedRuntimeStartCancellation,
                        portReadyTimeoutMS: portReadyTimeoutMs,
                    },
                })
                await Promise.all([
                    container.setAllowedHosts(materialization.egressAllowedHosts),
                    container.setDeniedHosts(hostedRuntimeDeniedHosts),
                ])
            },
        })
        if (outcome === 'delivered') {
            await waitForHostedRuntimeReady({
                container,
                token: runtimeToken,
                timeoutMs: hostedRuntimeStartCancellation.portReadyTimeoutMS,
                intervalMs: hostedRuntimeStartCancellation.waitInterval,
            })
            await hydrateHostedRuntimeFiles({
                container,
                token: runtimeToken,
                files: await roomFilesPromise,
            })
        }
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
            try {
                const converged = await convergeHostedRuntimeHealthIfReady({
                    env,
                    workspaceId: runtime.workspaceId,
                    roomId: runtime.roomId,
                })
                if (converged) {
                    console.warn(
                        'Hosted runtime health converged to running/healthy after a superseded materialization because the container is already ready',
                    )
                }
            } catch (convergeError) {
                console.warn(
                    'Hosted runtime health convergence after superseded materialization failed',
                    convergeError instanceof Error ? convergeError.message : convergeError,
                )
            }
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
        if (error instanceof HostedRuntimeRecreateDeferredError && recreateDeferralRetryable) {
            console.warn(
                'Hosted runtime recreate deferred; keeping desired running for a queue retry',
                { message: error.message },
            )
            throw error
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
