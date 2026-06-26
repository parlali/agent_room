import type {
    RoomExecutionModelState,
    RoomExecutionSnapshot,
    RoomExecutionThinkingLevel,
    RoomExecutionTruthSnapshot,
    RoomCronJob,
    RoomFileChangedPayload,
    RoomRunHistorySnapshot,
    RoomRuntimeOverview,
    RoomSessionWindow,
    RoomThreadAbortResult,
    RoomThreadCompactResult,
    RoomThreadForkResult,
    RoomThreadSendResult,
} from '../rooms/execution-types'
import type { JobSchedule } from '#/domain/job-schedule'
import { createRuntimeEventProxyStream } from '../rooms/runtime-event-proxy-stream'
import {
    abortSchema,
    compactSchema,
    createThreadSchema,
    forkSchema,
    sendSchema,
    sessionMutationSchema,
    sessionWindowSchema,
    snapshotSchema,
    threadModelSchema,
} from '../rooms/pi-execution-adapter/runtime-schemas'
import {
    abortThreadRuntimeRequest,
    compactThreadRuntimeRequest,
    createThreadRuntimeRequest,
    deleteThreadRuntimeRequest,
    editThreadMessageRuntimeRequest,
    forkThreadRuntimeRequest,
    renameThreadRuntimeRequest,
    sendThreadRuntimeRequest,
    updateThreadModelRuntimeRequest,
} from '../rooms/pi-execution-adapter/thread-requests'
import {
    buildRoomExecutionCapabilities,
    emptySnapshot,
} from '../rooms/pi-execution-adapter/runtime-overview'
import { wakeRoomRuntimeWithSnapshot } from '../rooms/wake-runtime'
import { buildRoomSetupSnapshot } from '../rooms/room-setup-read-model'
import { getHostedRoomMode, getHostedRuntimeState, listHostedRooms } from './hosted-room-service'
import {
    clearHostedSessionCompletedBadge,
    readHostedRoomOnboarding,
} from './hosted-room-read-model-service'
import { openHostedPiRuntimeStream, requestHostedPiRuntime } from './hosted-runtime-client'
import { assertHostedRunAllowed, requireHostedExecutionContext } from './hosted-execution-context'
import { hostedManagedModelId, hostedManagedModelProvider } from './hosted-model-policy'
import { hostedRoomPaths, hostedRuntimePort } from './hosted-runtime-paths'

const requireHosted = requireHostedExecutionContext
const hostedCronDisabledReason = 'Hosted scheduled jobs are not enabled'

function overview(input: {
    roomId: string
    displayName: string
    slug: string
    status: RoomRuntimeOverview['status']
    desiredState: RoomRuntimeOverview['desiredState']
    roomMode: RoomRuntimeOverview['roomMode']
    healthStatus: RoomRuntimeOverview['healthStatus']
    lastError: string | null
    lastHealthAt: string | null
}): RoomRuntimeOverview {
    return {
        roomId: input.roomId,
        displayName: input.displayName,
        slug: input.slug,
        status: input.status,
        desiredState: input.desiredState,
        roomMode: input.roomMode,
        healthStatus: input.healthStatus,
        port: input.healthStatus === 'healthy' ? hostedRuntimePort : null,
        pid: null,
        lastError: input.lastError,
        lastHealthAt: input.lastHealthAt,
    }
}

function throwHostedCronDisabled(): never {
    throw new Error(hostedCronDisabledReason)
}

export async function listRoomCronJobs(_input: {
    roomId: string
    limit?: number
}): Promise<RoomCronJob[]> {
    return []
}

export async function createRoomCronJob(_input: {
    roomId: string
    name: string
    message: string
    schedule: JobSchedule
}): Promise<RoomCronJob> {
    throwHostedCronDisabled()
}

export async function updateRoomCronJob(_input: {
    roomId: string
    jobId: string
    name: string
    message: string
    schedule: JobSchedule
}): Promise<RoomCronJob> {
    throwHostedCronDisabled()
}

export async function updateRoomCronJobEnabled(_input: {
    roomId: string
    jobId: string
    enabled: boolean
}): Promise<RoomCronJob> {
    throwHostedCronDisabled()
}

export async function runRoomCronJobNow(_input: {
    roomId: string
    jobId: string
}): Promise<{ ran: boolean; reason: string | null }> {
    return {
        ran: false,
        reason: hostedCronDisabledReason,
    }
}

export async function removeRoomCronJob(_input: { roomId: string; jobId: string }): Promise<void> {
    throwHostedCronDisabled()
}

export async function listRoomRunHistory(input: {
    roomId: string
    limit?: number
}): Promise<RoomRunHistorySnapshot> {
    return {
        roomId: input.roomId,
        mismatchCount: 0,
        entries: [],
    }
}

export async function listRoomsWithRuntime(_input: {
    actorUserId: string
}): Promise<RoomRuntimeOverview[]> {
    const { context, actor } = await requireHosted()
    const rooms = await listHostedRooms({
        env: context.env,
        actor,
    })
    return Promise.all(
        rooms.map(async (room) => {
            const [runtime, roomMode] = await Promise.all([
                getHostedRuntimeState({
                    env: context.env,
                    workspaceId: actor.workspaceId,
                    roomId: room.id,
                }),
                getHostedRoomMode({
                    env: context.env,
                    workspaceId: actor.workspaceId,
                    roomId: room.id,
                }),
            ])
            return overview({
                roomId: room.id,
                displayName: room.displayName,
                slug: room.slug,
                status: room.status,
                desiredState: room.desiredState,
                roomMode,
                healthStatus: runtime?.metadata?.healthStatus ?? null,
                lastError: runtime?.metadata?.lastError ?? null,
                lastHealthAt: runtime?.metadata?.lastHealthAt?.toISOString() ?? null,
            })
        }),
    )
}

export async function getRoomExecutionSnapshot(input: {
    roomId: string
    selectedThreadKey?: string | null
    messageLimit?: number
    actorUserId?: string | null
}): Promise<RoomExecutionSnapshot> {
    const { context, actor } = await requireHosted()
    const rooms = await listHostedRooms({
        env: context.env,
        actor,
    })
    const room = rooms.find((entry) => entry.id === input.roomId)
    if (!room) {
        throw new Error(`Room ${input.roomId} does not exist`)
    }
    const [runtime, onboarding, roomMode] = await Promise.all([
        getHostedRuntimeState({
            env: context.env,
            workspaceId: actor.workspaceId,
            roomId: input.roomId,
        }),
        readHostedRoomOnboarding({
            env: context.env,
            workspaceId: actor.workspaceId,
            roomId: input.roomId,
        }),
        getHostedRoomMode({
            env: context.env,
            workspaceId: actor.workspaceId,
            roomId: input.roomId,
        }),
    ])
    const roomOverview = overview({
        roomId: room.id,
        displayName: room.displayName,
        slug: room.slug,
        status: room.status,
        desiredState: room.desiredState,
        roomMode,
        healthStatus: runtime?.metadata?.healthStatus ?? null,
        lastError: runtime?.metadata?.lastError ?? null,
        lastHealthAt: runtime?.metadata?.lastHealthAt?.toISOString() ?? null,
    })
    const setup = buildRoomSetupSnapshot({
        room,
        runtimeMetadata: runtime?.metadata ?? null,
        onboarding,
    })
    if (room.status !== 'running' || runtime?.row.healthStatus !== 'healthy') {
        return emptySnapshot({
            room: roomOverview,
            setup,
            state: 'unavailable',
            message: runtime?.row.lastError ?? 'Hosted room runtime is not connected',
        })
    }
    try {
        const query = new URLSearchParams()
        if (input.selectedThreadKey) {
            query.set('selectedThreadKey', input.selectedThreadKey)
        }
        query.set('messageLimit', String(input.messageLimit ?? 200))
        const payload = await requestHostedPiRuntime({
            env: context.env,
            workspaceId: actor.workspaceId,
            roomId: input.roomId,
            path: `/snapshot?${query.toString()}`,
            schema: snapshotSchema,
        })
        return {
            room: roomOverview,
            setup,
            executionState: 'connected',
            executionMessage: null,
            capabilities: buildRoomExecutionCapabilities(true),
            ...payload,
            selectedThreadArtifacts: payload.selectedThreadArtifacts ?? [],
            browserSession: payload.browserSession ?? null,
        }
    } catch (error) {
        return emptySnapshot({
            room: roomOverview,
            setup,
            state: 'error',
            message: error instanceof Error ? error.message : 'Unknown hosted runtime error',
        })
    }
}

export async function getRoomSessionWindow(input: {
    roomId: string
    sessionKey: string
    before?: string | null
    after?: string | null
    limitRows?: number
}): Promise<RoomSessionWindow> {
    const { context, actor } = await requireHosted()
    const query = new URLSearchParams()
    query.set('limitRows', String(input.limitRows ?? 40))
    if (input.before) query.set('before', input.before)
    if (input.after) query.set('after', input.after)
    return requestHostedPiRuntime({
        env: context.env,
        workspaceId: actor.workspaceId,
        roomId: input.roomId,
        path: `/threads/${encodeURIComponent(input.sessionKey)}/window?${query.toString()}`,
        schema: sessionWindowSchema,
    })
}

export async function clearSessionCompletedBadge(input: {
    roomId: string
    sessionKey: string
    actorUserId: string
}): Promise<void> {
    const { context, actor } = await requireHosted()
    await clearHostedSessionCompletedBadge({
        env: context.env,
        actor,
        roomId: input.roomId,
        sessionKey: input.sessionKey,
    })
}

export async function createRoomThread(input: {
    roomId: string
    firstMessage?: string | null
}): Promise<{ key: string }> {
    const { context, actor } = await requireHosted()
    if (input.firstMessage?.trim()) {
        await assertHostedRunAllowed({
            env: context.env,
            workspaceId: actor.workspaceId,
            roomId: input.roomId,
            actorUserId: actor.userId,
            request: context.request,
        })
    }
    const request = createThreadRuntimeRequest({
        firstMessage: input.firstMessage ?? null,
        title: null,
        hideUserMessage: false,
        awaitInitialRun: false,
        internalInstruction: null,
        kind: 'main',
    })
    return requestHostedPiRuntime({
        env: context.env,
        workspaceId: actor.workspaceId,
        roomId: input.roomId,
        path: request.path,
        schema: createThreadSchema,
        method: request.method,
        body: request.body,
    })
}

export async function sendRoomThreadMessage(input: {
    roomId: string
    sessionKey: string
    message: string
    awaitCompletion?: boolean
}): Promise<RoomThreadSendResult> {
    const { context, actor } = await requireHosted()
    const request = sendThreadRuntimeRequest({
        sessionKey: input.sessionKey,
        message: input.message,
        awaitCompletion: input.awaitCompletion,
        runKind: 'manual',
        hideUserMessage: false,
    })
    await assertHostedRunAllowed({
        env: context.env,
        workspaceId: actor.workspaceId,
        roomId: input.roomId,
        actorUserId: actor.userId,
        request: context.request,
        sessionKey: input.sessionKey,
    })
    return requestHostedPiRuntime({
        env: context.env,
        workspaceId: actor.workspaceId,
        roomId: input.roomId,
        path: request.path,
        schema: sendSchema,
        method: request.method,
        body: request.body,
    })
}

export async function updateRoomThreadModel(input: {
    roomId: string
    sessionKey: string
    provider: string
    model: string
    thinkingLevel?: RoomExecutionThinkingLevel | null
    speedMode?: RoomExecutionModelState['speedMode']
}): Promise<RoomExecutionModelState> {
    const { context, actor } = await requireHosted()
    const runtime = await getHostedRuntimeState({
        env: context.env,
        workspaceId: actor.workspaceId,
        roomId: input.roomId,
    })
    if (
        runtime?.row.providerCandidate === 'hosted_openrouter' &&
        (input.provider !== hostedManagedModelProvider || input.model !== hostedManagedModelId)
    ) {
        throw new Error('Hosted rooms can only use the managed hosted model')
    }
    const request = updateThreadModelRuntimeRequest(input)
    return requestHostedPiRuntime({
        env: context.env,
        workspaceId: actor.workspaceId,
        roomId: input.roomId,
        path: request.path,
        schema: threadModelSchema,
        method: request.method,
        body: request.body,
    })
}

export async function abortRoomThreadMessage(input: {
    roomId: string
    sessionKey: string
    runId?: string | null
}): Promise<RoomThreadAbortResult> {
    const { context, actor } = await requireHosted()
    const request = abortThreadRuntimeRequest(input)
    return requestHostedPiRuntime({
        env: context.env,
        workspaceId: actor.workspaceId,
        roomId: input.roomId,
        path: request.path,
        schema: abortSchema,
        method: request.method,
        body: request.body,
    })
}

export async function compactRoomThread(input: {
    roomId: string
    sessionKey: string
    instructions?: string | null
}): Promise<RoomThreadCompactResult> {
    const { context, actor } = await requireHosted()
    await assertHostedRunAllowed({
        env: context.env,
        workspaceId: actor.workspaceId,
        roomId: input.roomId,
        actorUserId: actor.userId,
        request: context.request,
        sessionKey: input.sessionKey,
    })
    const request = compactThreadRuntimeRequest(input)
    return requestHostedPiRuntime({
        env: context.env,
        workspaceId: actor.workspaceId,
        roomId: input.roomId,
        path: request.path,
        schema: compactSchema,
        method: request.method,
        body: request.body,
    })
}

export async function forkRoomThread(input: {
    roomId: string
    sessionKey: string
    title?: string | null
    entryId?: string | null
}): Promise<RoomThreadForkResult> {
    const { context, actor } = await requireHosted()
    const request = forkThreadRuntimeRequest(input)
    return requestHostedPiRuntime({
        env: context.env,
        workspaceId: actor.workspaceId,
        roomId: input.roomId,
        path: request.path,
        schema: forkSchema,
        method: request.method,
        body: request.body,
    })
}

export async function editRoomThreadMessage(input: {
    roomId: string
    sessionKey: string
    messageId: string
    message: string
}): Promise<RoomThreadSendResult> {
    const { context, actor } = await requireHosted()
    const request = editThreadMessageRuntimeRequest(input)
    await assertHostedRunAllowed({
        env: context.env,
        workspaceId: actor.workspaceId,
        roomId: input.roomId,
        actorUserId: actor.userId,
        request: context.request,
        sessionKey: input.sessionKey,
    })
    return requestHostedPiRuntime({
        env: context.env,
        workspaceId: actor.workspaceId,
        roomId: input.roomId,
        path: request.path,
        schema: sendSchema,
        method: request.method,
        body: request.body,
    })
}

export function createRoomSessionEventStream(input: {
    roomId: string
    sessionKey: string
    abortSignal?: AbortSignal
}): ReadableStream<Uint8Array> {
    return createRuntimeEventProxyStream({
        roomId: input.roomId,
        sessionKey: input.sessionKey,
        streamKind: 'session',
        abortSignal: input.abortSignal,
        open: async () => {
            const { context, actor } = await requireHosted()
            return openHostedPiRuntimeStream({
                env: context.env,
                workspaceId: actor.workspaceId,
                roomId: input.roomId,
                path: `/threads/${encodeURIComponent(input.sessionKey)}/events`,
                signal: input.abortSignal,
            })
        },
    })
}

export function createRoomEventStream(input: {
    roomId: string
    abortSignal?: AbortSignal
}): ReadableStream<Uint8Array> {
    return createRuntimeEventProxyStream({
        roomId: input.roomId,
        sessionKey: null,
        streamKind: 'room',
        abortSignal: input.abortSignal,
        open: async () => {
            const { context, actor } = await requireHosted()
            return openHostedPiRuntimeStream({
                env: context.env,
                workspaceId: actor.workspaceId,
                roomId: input.roomId,
                path: '/events',
                signal: input.abortSignal,
            })
        },
    })
}

export async function publishRoomFileChanged(input: RoomFileChangedPayload): Promise<void> {
    const { context, actor } = await requireHosted()
    await requestHostedPiRuntime({
        env: context.env,
        workspaceId: actor.workspaceId,
        roomId: input.roomId,
        path: '/events/file-changed',
        schema: sessionMutationSchema,
        method: 'POST',
        body: input,
    })
}

export async function deleteRoomSession(input: {
    roomId: string
    sessionKey: string
}): Promise<void> {
    const { context, actor } = await requireHosted()
    const request = deleteThreadRuntimeRequest(input)
    await requestHostedPiRuntime({
        env: context.env,
        workspaceId: actor.workspaceId,
        roomId: input.roomId,
        path: request.path,
        schema: sessionMutationSchema,
        method: request.method,
    })
}

export async function renameRoomSession(input: {
    roomId: string
    sessionKey: string
    title: string
}): Promise<void> {
    const { context, actor } = await requireHosted()
    const request = renameThreadRuntimeRequest(input)
    await requestHostedPiRuntime({
        env: context.env,
        workspaceId: actor.workspaceId,
        roomId: input.roomId,
        path: request.path,
        schema: sessionMutationSchema,
        method: request.method,
        body: request.body,
    })
}

export async function wakeRoomRuntime(input: {
    roomId: string
    text: string
    mode: 'now' | 'next-heartbeat'
}): Promise<void> {
    const { context, actor } = await requireHosted()
    await wakeRoomRuntimeWithSnapshot({
        mode: input.mode,
        text: input.text,
        deferredMessage: 'Deferred heartbeat wake is not implemented for hosted runtime',
        readSnapshot: () =>
            requestHostedPiRuntime({
                env: context.env,
                workspaceId: actor.workspaceId,
                roomId: input.roomId,
                path: '/snapshot',
                schema: snapshotSchema,
            }),
        createThread: async (firstMessage) => {
            await createRoomThread({
                roomId: input.roomId,
                firstMessage,
            })
        },
        sendThreadMessage: async (sessionKey, message) => {
            await sendRoomThreadMessage({
                roomId: input.roomId,
                sessionKey,
                message,
            })
        },
    })
}

export async function getRoomExecutionTruthSnapshot(input: {
    roomId: string
}): Promise<RoomExecutionTruthSnapshot> {
    const { context, actor } = await requireHosted()
    const runtime = await getHostedRuntimeState({
        env: context.env,
        workspaceId: actor.workspaceId,
        roomId: input.roomId,
    })
    const paths = hostedRoomPaths()
    return {
        roomId: input.roomId,
        stateDirPath: paths.engineStateDir,
        workspaceDirPath: paths.workspaceDir,
        storeDirPath: paths.storeDir,
        runtimeConfigPath: paths.runtimeConfigPath,
        runtimeMetadataPath: paths.runtimeMetadataPath,
        runtimeHealthPath: paths.runtimeHealthPath,
        runtimeMetadataFile: runtime
            ? {
                  port: runtime.metadata?.port ?? null,
                  pid: null,
                  sandboxUid: null,
                  sandboxGid: null,
                  sandboxUserName: null,
                  sandboxGroupName: null,
                  startedAt: runtime.metadata?.startedAt?.toISOString() ?? null,
                  configVersion: runtime.row.configVersion,
                  tokenVersion: runtime.row.tokenVersion,
              }
            : null,
        runtimeHealthFile: runtime
            ? {
                  healthy: runtime.row.healthStatus === 'healthy',
                  message: runtime.row.lastError ?? runtime.row.healthStatus,
                  checkedAt: runtime.row.lastHealthAt ?? runtime.row.updatedAt,
              }
            : null,
        runtimeConfigFile: {
            bind: '0.0.0.0',
            port: hostedRuntimePort,
            workspace: paths.workspaceDir,
        },
        agents: [
            {
                agentId: 'main',
                workspacePath: paths.workspaceDir,
                memoryPath: `${paths.engineStateDir}/internal-state`,
                sessionsPath: `${paths.engineStateDir}/sessions`,
                memoryExists: runtime !== null,
                sessionsExists: runtime !== null,
                sessionFileCount: 0,
                latestSessionUpdateAt: null,
            },
        ],
    }
}
