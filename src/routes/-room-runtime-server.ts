import { createServerFn } from '@tanstack/react-start'
import { setResponseHeaders } from '@tanstack/react-start/server'
import { z } from 'zod'
import {
    providerApis,
    roomDesiredStates,
    roomProviderModes,
    roomToolProfiles,
} from '#/server/domain/types'
import type { UsageEventRecord } from '#/server/domain/types'

const roomIdSchema = z.string().uuid()

const roomExecutionInputSchema = z.object({
    roomId: roomIdSchema,
    selectedThreadKey: z.string().min(1).nullable().optional(),
})

const sendMessageInputSchema = z.object({
    roomId: roomIdSchema,
    sessionKey: z.string().min(1),
    message: z.string().min(1),
})

const abortMessageInputSchema = z.object({
    roomId: roomIdSchema,
    sessionKey: z.string().min(1),
    runId: z.string().min(1).nullable().optional(),
})

const createThreadInputSchema = z.object({
    roomId: roomIdSchema,
    firstMessage: z.string().nullable().optional(),
})

const listCronJobsInputSchema = z.object({
    roomId: roomIdSchema,
})

const createCronJobInputSchema = z.object({
    roomId: roomIdSchema,
    name: z.string().min(1),
    message: z.string().min(1),
    everyMinutes: z.number().int().positive(),
})

const updateCronJobInputSchema = createCronJobInputSchema.extend({
    jobId: z.string().min(1),
})

const setCronEnabledInputSchema = z.object({
    roomId: roomIdSchema,
    jobId: z.string().min(1),
    enabled: z.boolean(),
})

const runCronJobInputSchema = z.object({
    roomId: roomIdSchema,
    jobId: z.string().min(1),
})

const removeCronJobInputSchema = z.object({
    roomId: roomIdSchema,
    jobId: z.string().min(1),
})

const wakeRoomInputSchema = z.object({
    roomId: roomIdSchema,
    text: z.string().min(1),
    mode: z.enum(['now', 'next-heartbeat']).optional(),
})

const roomExecutionTruthInputSchema = z.object({
    roomId: roomIdSchema,
})

const roomRunHistoryInputSchema = z.object({
    roomId: roomIdSchema,
    limit: z.number().int().positive().max(200).optional(),
})

const roomUsageInputSchema = z.object({
    roomId: roomIdSchema,
    limit: z.number().int().positive().max(200).optional(),
})

const usageInputSchema = z.object({
    limit: z.number().int().positive().max(500).optional(),
})

const roomFilesInputSchema = z.object({
    roomId: roomIdSchema,
})

const readRoomFileInputSchema = z.object({
    roomId: roomIdSchema,
    surface: z.enum(['workspace', 'store']),
    relativePath: z.string().min(1),
})

const roomMemoryInputSchema = z.object({
    roomId: roomIdSchema,
})

const updateRoomMemoryInputSchema = z.object({
    roomId: roomIdSchema,
    memory: z.unknown(),
    expectedHash: z.string().min(1).nullable().optional(),
})

const deleteRoomInputSchema = z.object({
    roomId: roomIdSchema,
    confirmSlug: z.string().min(1),
})

const deleteSessionInputSchema = z.object({
    roomId: roomIdSchema,
    sessionKey: z.string().min(1),
})

const renameSessionInputSchema = z.object({
    roomId: roomIdSchema,
    sessionKey: z.string().min(1),
    title: z.string().min(1).max(200),
})

const createRoomInputSchema = z.object({
    displayName: z.string().min(1),
    slug: z.string().min(1).nullable().optional(),
    startImmediately: z.boolean().optional(),
    instructions: z.string().optional(),
    providerMode: z.enum(roomProviderModes).optional(),
    providerConnectionId: z.string().uuid().nullable().optional(),
    provider: z.string().nullable().optional(),
    providerApi: z.enum(providerApis).nullable().optional(),
    providerBaseUrl: z.string().nullable().optional(),
    providerModel: z.string().nullable().optional(),
    providerApiKey: z.string().optional(),
    toolsProfile: z.enum(roomToolProfiles).optional(),
    cronTimezone: z.string().min(1).optional(),
    mcpConnectionIds: z.array(z.string().uuid()).optional(),
    initialCron: z
        .object({
            name: z.string().min(1),
            message: z.string().min(1),
            everyMinutes: z.number().int().positive(),
        })
        .nullable()
        .optional(),
})

const setRoomDesiredStateInputSchema = z.object({
    roomId: z.string().min(1),
    desiredState: z.enum(roomDesiredStates),
})

const updateRoomIdentityInputSchema = z.object({
    roomId: z.string().uuid(),
    displayName: z.string().min(1),
    slug: z.string().min(1).nullable().optional(),
})

async function ensureRuntimeSupervisorBoot() {
    const { ensureRuntimeSupervisorBoot: ensureBoot } =
        await import('#/server/rooms/runtime-supervisor-bootstrap')
    await ensureBoot()
}

async function requireAuthenticatedActor() {
    const { requireAuthenticatedActor: requireActor } = await import('#/server/auth/session-auth')
    return requireActor()
}

async function requireMutationActor() {
    const { assertSameOriginMutation } = await import('#/server/auth/session-auth')
    assertSameOriginMutation()
    return requireAuthenticatedActor()
}

function summarizeUsageEvents(events: UsageEventRecord[]) {
    const knownTokenEvents = events.filter((event) => event.totalTokens !== null)
    const knownCostEvents = events.filter((event) => event.estimatedCostUsd !== null)
    return {
        durationMs: events.reduce((sum, event) => sum + (event.durationMs ?? 0), 0),
        totalTokens:
            knownTokenEvents.length === 0
                ? null
                : knownTokenEvents.reduce((sum, event) => sum + (event.totalTokens ?? 0), 0),
        estimatedCostUsd:
            knownCostEvents.length === 0
                ? null
                : knownCostEvents.reduce(
                      (sum, event) => sum + Number(event.estimatedCostUsd ?? 0),
                      0,
                  ),
        unknownTokenEvents: events.length - knownTokenEvents.length,
    }
}

export const listRoomsServer = createServerFn({ method: 'GET' }).handler(async () => {
    await requireAuthenticatedActor()
    setResponseHeaders({
        'cache-control': 'no-store',
    })
    await ensureRuntimeSupervisorBoot()
    const { listRoomsWithRuntime } = await import('#/server/rooms/execution-engine')
    return listRoomsWithRuntime()
})

export const getRoomSetupReadinessServer = createServerFn({ method: 'GET' }).handler(async () => {
    await requireAuthenticatedActor()
    setResponseHeaders({
        'cache-control': 'no-store',
    })
    const { getRoomSetupReadiness } = await import('#/server/rooms/runtime-readiness')
    return getRoomSetupReadiness()
})

export const createRoomServer = createServerFn({ method: 'POST' })
    .inputValidator((input: unknown) => createRoomInputSchema.parse(input))
    .handler(async ({ data }) => {
        const actor = await requireMutationActor()
        const { createRoom } = await import('#/server/rooms/room-service')
        return createRoom({
            displayName: data.displayName,
            slug: data.slug ?? undefined,
            createdByUserId: actor.userId,
            startImmediately: data.startImmediately ?? true,
            instructions: data.instructions,
            providerMode: data.providerMode,
            providerConnectionId: data.providerConnectionId,
            provider: data.provider,
            providerApi: data.providerApi,
            providerBaseUrl: data.providerBaseUrl,
            providerModel: data.providerModel,
            providerApiKey: data.providerApiKey,
            toolsProfile: data.toolsProfile,
            cronTimezone: data.cronTimezone,
            mcpConnectionIds: data.mcpConnectionIds,
            initialCron: data.initialCron,
        })
    })

export const setRoomDesiredStateServer = createServerFn({ method: 'POST' })
    .inputValidator((input: unknown) => setRoomDesiredStateInputSchema.parse(input))
    .handler(async ({ data }) => {
        const actor = await requireMutationActor()
        const { setRoomDesiredState } = await import('#/server/rooms/room-service')
        await setRoomDesiredState({
            roomId: data.roomId,
            desiredState: data.desiredState,
            actorUserId: actor.userId,
        })
        return {
            ok: true,
        }
    })

export const updateRoomIdentityServer = createServerFn({ method: 'POST' })
    .inputValidator((input: unknown) => updateRoomIdentityInputSchema.parse(input))
    .handler(async ({ data }) => {
        const actor = await requireMutationActor()
        const { updateRoomIdentity } = await import('#/server/rooms/room-service')
        return updateRoomIdentity({
            roomId: data.roomId,
            displayName: data.displayName,
            slug: data.slug ?? null,
            actorUserId: actor.userId,
        })
    })

export const getRoomExecutionServer = createServerFn({ method: 'GET' })
    .inputValidator((input: unknown) => roomExecutionInputSchema.parse(input))
    .handler(async ({ data }) => {
        await requireAuthenticatedActor()
        setResponseHeaders({
            'cache-control': 'no-store',
        })
        await ensureRuntimeSupervisorBoot()
        const { getRoomExecutionSnapshot } = await import('#/server/rooms/execution-engine')
        return getRoomExecutionSnapshot({
            roomId: data.roomId,
            selectedThreadKey: data.selectedThreadKey ?? null,
        })
    })

export const sendMessageServer = createServerFn({ method: 'POST' })
    .inputValidator((input: unknown) => sendMessageInputSchema.parse(input))
    .handler(async ({ data }) => {
        await requireMutationActor()
        await ensureRuntimeSupervisorBoot()
        const { sendRoomThreadMessage } = await import('#/server/rooms/execution-engine')
        return sendRoomThreadMessage({
            roomId: data.roomId,
            sessionKey: data.sessionKey,
            message: data.message,
        })
    })

export const abortMessageServer = createServerFn({ method: 'POST' })
    .inputValidator((input: unknown) => abortMessageInputSchema.parse(input))
    .handler(async ({ data }) => {
        await requireMutationActor()
        await ensureRuntimeSupervisorBoot()
        const { abortRoomThreadMessage } = await import('#/server/rooms/execution-engine')
        return abortRoomThreadMessage({
            roomId: data.roomId,
            sessionKey: data.sessionKey,
            runId: data.runId ?? null,
        })
    })

export const createThreadServer = createServerFn({ method: 'POST' })
    .inputValidator((input: unknown) => createThreadInputSchema.parse(input))
    .handler(async ({ data }) => {
        await requireMutationActor()
        await ensureRuntimeSupervisorBoot()
        const { createRoomThread } = await import('#/server/rooms/execution-engine')
        return createRoomThread({
            roomId: data.roomId,
            firstMessage: data.firstMessage,
        })
    })

export const listCronJobsServer = createServerFn({ method: 'GET' })
    .inputValidator((input: unknown) => listCronJobsInputSchema.parse(input))
    .handler(async ({ data }) => {
        await requireAuthenticatedActor()
        setResponseHeaders({
            'cache-control': 'no-store',
        })
        await ensureRuntimeSupervisorBoot()
        const { listRoomCronJobs } = await import('#/server/rooms/execution-engine')
        return listRoomCronJobs({
            roomId: data.roomId,
        })
    })

export const createCronJobServer = createServerFn({ method: 'POST' })
    .inputValidator((input: unknown) => createCronJobInputSchema.parse(input))
    .handler(async ({ data }) => {
        await requireMutationActor()
        await ensureRuntimeSupervisorBoot()
        const { createRoomCronJob } = await import('#/server/rooms/execution-engine')
        return createRoomCronJob({
            roomId: data.roomId,
            name: data.name,
            message: data.message,
            everyMinutes: data.everyMinutes,
        })
    })

export const updateCronJobServer = createServerFn({ method: 'POST' })
    .inputValidator((input: unknown) => updateCronJobInputSchema.parse(input))
    .handler(async ({ data }) => {
        await requireMutationActor()
        await ensureRuntimeSupervisorBoot()
        const { updateRoomCronJob } = await import('#/server/rooms/execution-engine')
        return updateRoomCronJob({
            roomId: data.roomId,
            jobId: data.jobId,
            name: data.name,
            message: data.message,
            everyMinutes: data.everyMinutes,
        })
    })

export const setCronEnabledServer = createServerFn({ method: 'POST' })
    .inputValidator((input: unknown) => setCronEnabledInputSchema.parse(input))
    .handler(async ({ data }) => {
        await requireMutationActor()
        await ensureRuntimeSupervisorBoot()
        const { updateRoomCronJobEnabled } = await import('#/server/rooms/execution-engine')
        return updateRoomCronJobEnabled({
            roomId: data.roomId,
            jobId: data.jobId,
            enabled: data.enabled,
        })
    })

export const runCronJobServer = createServerFn({ method: 'POST' })
    .inputValidator((input: unknown) => runCronJobInputSchema.parse(input))
    .handler(async ({ data }) => {
        await requireMutationActor()
        await ensureRuntimeSupervisorBoot()
        const { runRoomCronJobNow } = await import('#/server/rooms/execution-engine')
        return runRoomCronJobNow({
            roomId: data.roomId,
            jobId: data.jobId,
        })
    })

export const removeCronJobServer = createServerFn({ method: 'POST' })
    .inputValidator((input: unknown) => removeCronJobInputSchema.parse(input))
    .handler(async ({ data }) => {
        await requireMutationActor()
        await ensureRuntimeSupervisorBoot()
        const { removeRoomCronJob } = await import('#/server/rooms/execution-engine')
        return removeRoomCronJob({
            roomId: data.roomId,
            jobId: data.jobId,
        })
    })

export const wakeRoomServer = createServerFn({ method: 'POST' })
    .inputValidator((input: unknown) => wakeRoomInputSchema.parse(input))
    .handler(async ({ data }) => {
        await requireMutationActor()
        await ensureRuntimeSupervisorBoot()
        const { wakeRoomRuntime } = await import('#/server/rooms/execution-engine')
        return wakeRoomRuntime({
            roomId: data.roomId,
            text: data.text,
            mode: data.mode ?? 'now',
        })
    })

export const getRoomExecutionTruthServer = createServerFn({ method: 'GET' })
    .inputValidator((input: unknown) => roomExecutionTruthInputSchema.parse(input))
    .handler(async ({ data }) => {
        await requireAuthenticatedActor()
        setResponseHeaders({
            'cache-control': 'no-store',
        })
        await ensureRuntimeSupervisorBoot()
        const { getRoomExecutionTruthSnapshot } = await import('#/server/rooms/execution-engine')
        return getRoomExecutionTruthSnapshot({
            roomId: data.roomId,
        })
    })

export const listRoomRunHistoryServer = createServerFn({ method: 'GET' })
    .inputValidator((input: unknown) => roomRunHistoryInputSchema.parse(input))
    .handler(async ({ data }) => {
        await requireAuthenticatedActor()
        setResponseHeaders({
            'cache-control': 'no-store',
        })
        await ensureRuntimeSupervisorBoot()
        const { listRoomRunHistory } = await import('#/server/rooms/execution-engine')
        return listRoomRunHistory({
            roomId: data.roomId,
            limit: data.limit ?? 100,
        })
    })

export const listRoomUsageServer = createServerFn({ method: 'GET' })
    .inputValidator((input: unknown) => roomUsageInputSchema.parse(input))
    .handler(async ({ data }) => {
        await requireAuthenticatedActor()
        setResponseHeaders({
            'cache-control': 'no-store',
        })
        const { syncRoomRuntimeUsage } = await import('#/server/rooms/execution-engine')
        await syncRoomRuntimeUsage(data.roomId)
        const { usageRepository } = await import('#/server/db/repositories')
        const events = await usageRepository.listByRoom({
            roomId: data.roomId,
            limit: data.limit ?? 100,
        })
        return {
            roomId: data.roomId,
            events,
            totals: summarizeUsageEvents(events),
        }
    })

export const listUsageServer = createServerFn({ method: 'GET' })
    .inputValidator((input: unknown) => usageInputSchema.parse(input ?? {}))
    .handler(async ({ data }) => {
        await requireAuthenticatedActor()
        setResponseHeaders({
            'cache-control': 'no-store',
        })
        const { syncAllRuntimeUsage } = await import('#/server/rooms/execution-engine')
        await syncAllRuntimeUsage()
        const { usageRepository } = await import('#/server/db/repositories')
        const events = await usageRepository.listRecent({
            limit: data.limit ?? 300,
        })
        return {
            events,
            totals: summarizeUsageEvents(events),
        }
    })

export const listRoomFilesServer = createServerFn({ method: 'GET' })
    .inputValidator((input: unknown) => roomFilesInputSchema.parse(input))
    .handler(async ({ data }) => {
        await requireAuthenticatedActor()
        setResponseHeaders({
            'cache-control': 'no-store',
        })
        const { listRoomFiles } = await import('#/server/rooms/file-store')
        return listRoomFiles(data.roomId)
    })

export const readRoomFileServer = createServerFn({ method: 'GET' })
    .inputValidator((input: unknown) => readRoomFileInputSchema.parse(input))
    .handler(async ({ data }) => {
        await requireAuthenticatedActor()
        setResponseHeaders({
            'cache-control': 'no-store',
        })
        const { readRoomFileContent } = await import('#/server/rooms/file-store')
        return readRoomFileContent({
            roomId: data.roomId,
            surface: data.surface,
            relativePath: data.relativePath,
        })
    })

export const getRoomMemoryServer = createServerFn({ method: 'GET' })
    .inputValidator((input: unknown) => roomMemoryInputSchema.parse(input))
    .handler(async ({ data }) => {
        await requireAuthenticatedActor()
        setResponseHeaders({
            'cache-control': 'no-store',
        })
        const { readRoomMemory } = await import('#/server/rooms/room-memory-store')
        return readRoomMemory(data.roomId)
    })

export const updateRoomMemoryServer = createServerFn({ method: 'POST' })
    .inputValidator((input: unknown) => updateRoomMemoryInputSchema.parse(input))
    .handler(async ({ data }) => {
        await requireMutationActor()
        const { updateRoomMemory } = await import('#/server/rooms/room-memory-store')
        return updateRoomMemory({
            roomId: data.roomId,
            memory: data.memory,
            expectedHash: data.expectedHash ?? null,
        })
    })

export const deleteRoomServer = createServerFn({ method: 'POST' })
    .inputValidator((input: unknown) => deleteRoomInputSchema.parse(input))
    .handler(async ({ data }) => {
        const actor = await requireMutationActor()
        const { roomRepository } = await import('#/server/db/repositories')
        const room = await roomRepository.findRoomById(data.roomId)
        if (!room) {
            throw new Error('Room not found')
        }
        if (room.slug !== data.confirmSlug) {
            throw new Error('Confirmation slug does not match room slug')
        }
        const { deleteRoom } = await import('#/server/rooms/room-service')
        await deleteRoom({
            roomId: data.roomId,
            actorUserId: actor.userId,
        })
        return { ok: true }
    })

export const deleteSessionServer = createServerFn({ method: 'POST' })
    .inputValidator((input: unknown) => deleteSessionInputSchema.parse(input))
    .handler(async ({ data }) => {
        await requireMutationActor()
        await ensureRuntimeSupervisorBoot()
        const { deleteRoomSession } = await import('#/server/rooms/execution-engine')
        await deleteRoomSession({
            roomId: data.roomId,
            sessionKey: data.sessionKey,
        })
        return { ok: true }
    })

export const renameSessionServer = createServerFn({ method: 'POST' })
    .inputValidator((input: unknown) => renameSessionInputSchema.parse(input))
    .handler(async ({ data }) => {
        await requireMutationActor()
        await ensureRuntimeSupervisorBoot()
        const { renameRoomSession } = await import('#/server/rooms/execution-engine')
        await renameRoomSession({
            roomId: data.roomId,
            sessionKey: data.sessionKey,
            title: data.title,
        })
        return { ok: true }
    })
