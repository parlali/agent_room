import { createServerFn } from '@tanstack/react-start'
import { setResponseHeaders } from '@tanstack/react-start/server'
import { z } from 'zod'
import { roomModes, roomDesiredStates, roomProviderModes } from '#/domain/domain-types'
import { maxSessionComposerDraftLength } from '#/domain/session-composer-draft'

const loadRoomRuntimeRouteService = () => import('#/server/rooms/room-runtime-route-service')

const loadRoomRuntimeSnapshotRouteService = () =>
    import('#/server/rooms/room-runtime-snapshot-route-service')

const roomIdSchema = z.string().uuid()

const roomExecutionInputSchema = z.object({
    roomId: roomIdSchema,
    selectedThreadKey: z.string().min(1).nullable().optional(),
    messageLimit: z.number().int().min(0).max(200).optional(),
})

const sessionWindowInputSchema = z.object({
    roomId: roomIdSchema,
    sessionKey: z.string().min(1),
    before: z.string().min(1).nullable().optional(),
    after: z.string().min(1).nullable().optional(),
    limitRows: z.number().int().min(1).max(120).optional(),
})

const sessionBadgeInputSchema = z.object({
    roomId: roomIdSchema,
    sessionKey: z.string().min(1),
})

const sessionComposerDraftInputSchema = z.object({
    roomId: roomIdSchema,
    sessionKey: z.string().min(1),
})

const saveSessionComposerDraftInputSchema = sessionComposerDraftInputSchema.extend({
    draft: z.string().max(maxSessionComposerDraftLength),
})

const sendMessageInputSchema = z.object({
    roomId: roomIdSchema,
    sessionKey: z.string().min(1),
    message: z.string().min(1),
})

const editMessageInputSchema = sendMessageInputSchema.extend({
    messageId: z.string().min(1),
})

const updateThreadModelInputSchema = z.object({
    roomId: roomIdSchema,
    sessionKey: z.string().min(1),
    provider: z.string().min(1),
    model: z.string().min(1),
    thinkingLevel: z
        .enum(['off', 'minimal', 'low', 'medium', 'high', 'xhigh'])
        .nullable()
        .optional(),
    speedMode: z.enum(['normal', 'fast']).nullable().optional(),
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

const jobScheduleSchema = z.discriminatedUnion('type', [
    z.object({
        type: z.literal('interval'),
        every: z.number().int().positive(),
        unit: z.enum(['minutes', 'hours', 'days', 'weeks']),
    }),
    z.object({
        type: z.literal('daily'),
        times: z
            .array(z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/))
            .min(1)
            .max(8),
    }),
    z.object({
        type: z.literal('weekly'),
        weekdays: z.array(z.number().int().min(0).max(6)).min(1).max(7),
        time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
    }),
    z.object({
        type: z.literal('monthly'),
        day: z.number().int().min(1).max(31),
        time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
    }),
])

const createCronJobInputSchema = z.object({
    roomId: roomIdSchema,
    name: z.string().min(1),
    message: z.string().min(1),
    schedule: jobScheduleSchema,
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

const roomUsageInputSchema = z.object({
    roomId: roomIdSchema,
    limit: z.number().int().positive().max(200).optional(),
})

const usageInputSchema = z.object({
    limit: z.number().int().positive().max(500).optional(),
})

const clientPerformanceInputSchema = z.object({
    name: z.enum([
        'navigation.paint',
        'route.remount',
        'document.navigation',
        'long.main_thread_task',
        'chat.selection.shell_paint',
        'chat.selection.latest_message_paint',
        'chat.markdown.render',
        'chat.window.render',
        'artifact.panel.mount',
        'artifact.panel.open',
    ]),
    roomId: roomIdSchema.nullable().optional(),
    sessionKey: z.string().min(1).nullable().optional(),
    rowCount: z.number().int().min(0).nullable().optional(),
    virtualRowCount: z.number().int().min(0).nullable().optional(),
    totalRows: z.number().int().min(0).nullable().optional(),
    durationMs: z.number().min(0).nullable().optional(),
    textLength: z.number().int().min(0).nullable().optional(),
    routePath: z.string().max(300).nullable().optional(),
    navigationType: z.string().max(80).nullable().optional(),
})

const roomFilesInputSchema = z.object({
    roomId: roomIdSchema,
})

const roomFileSurfaceSchema = z.enum(['workspace', 'store'])

const listRoomDirectoryInputSchema = z.object({
    roomId: roomIdSchema,
    surface: roomFileSurfaceSchema,
    relativePath: z.string().optional(),
})

const readRoomFileInputSchema = z.object({
    roomId: roomIdSchema,
    surface: roomFileSurfaceSchema,
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
    roomMode: z.enum(roomModes).optional(),
    cronTimezone: z.string().min(1).optional(),
    mcpConnectionIds: z.array(z.string().uuid()).optional(),
    initialCron: z
        .object({
            name: z.string().min(1),
            message: z.string().min(1),
            schedule: jobScheduleSchema,
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

export const listRoomsServer = createServerFn({ method: 'GET' }).handler(async () => {
    const { requireAuthenticatedActor, ensureRuntimeSupervisorBoot } =
        await loadRoomRuntimeRouteService()
    const actor = await requireAuthenticatedActor()
    setResponseHeaders({
        'cache-control': 'no-store',
    })
    await ensureRuntimeSupervisorBoot()
    const { listRoomsWithRuntime } = await import('#/server/rooms/execution-engine')
    return listRoomsWithRuntime({
        actorUserId: actor.userId,
    })
})

export const createRoomServer = createServerFn({ method: 'POST' })
    .inputValidator((input: unknown) => createRoomInputSchema.parse(input))
    .handler(async ({ data }) => {
        try {
            const { createRoomForRoute } = await loadRoomRuntimeRouteService()
            return await createRoomForRoute(data)
        } catch (error) {
            const normalized = error instanceof Error ? error : new Error(String(error))
            const code = (error as { code?: unknown }).code
            throw new Error(
                `DBG2 ${normalized.name} [${String(code ?? 'no-code')}] ${normalized.message} :: ${(normalized.stack ?? '').slice(0, 1800)}`,
            )
        }
    })

export const setRoomDesiredStateServer = createServerFn({ method: 'POST' })
    .inputValidator((input: unknown) => setRoomDesiredStateInputSchema.parse(input))
    .handler(async ({ data }) => {
        const { setRoomDesiredStateForRoute } = await loadRoomRuntimeRouteService()
        return setRoomDesiredStateForRoute(data)
    })

export const updateRoomIdentityServer = createServerFn({ method: 'POST' })
    .inputValidator((input: unknown) => updateRoomIdentityInputSchema.parse(input))
    .handler(async ({ data }) => {
        const { updateRoomIdentityForRoute } = await loadRoomRuntimeRouteService()
        return updateRoomIdentityForRoute(data)
    })

export const getRoomExecutionServer = createServerFn({ method: 'GET' })
    .inputValidator((input: unknown) => roomExecutionInputSchema.parse(input))
    .handler(async ({ data }) => {
        const { getRoomExecutionForRoute } = await loadRoomRuntimeSnapshotRouteService()
        return getRoomExecutionForRoute(data)
    })

export const getRoomSidebarServer = createServerFn({ method: 'GET' })
    .inputValidator((input: unknown) => roomExecutionTruthInputSchema.parse(input))
    .handler(async ({ data }) => {
        const { getRoomSidebarForRoute } = await loadRoomRuntimeSnapshotRouteService()
        return getRoomSidebarForRoute(data)
    })

export const getRoomSessionShellServer = createServerFn({ method: 'GET' })
    .inputValidator((input: unknown) =>
        z
            .object({
                roomId: roomIdSchema,
                sessionKey: z.string().min(1),
            })
            .parse(input),
    )
    .handler(async ({ data }) => {
        const { getRoomSessionShellForRoute } = await loadRoomRuntimeSnapshotRouteService()
        return getRoomSessionShellForRoute(data)
    })

export const getRoomSessionWindowServer = createServerFn({ method: 'GET' })
    .inputValidator((input: unknown) => sessionWindowInputSchema.parse(input))
    .handler(async ({ data }) => {
        const { requireAuthenticatedActor, requireRoomOwner, ensureRuntimeSupervisorBoot } =
            await loadRoomRuntimeRouteService()
        const actor = await requireAuthenticatedActor()
        setResponseHeaders({
            'cache-control': 'no-store',
        })
        await requireRoomOwner(actor, data.roomId)
        await ensureRuntimeSupervisorBoot()
        const { getRoomSessionWindow } = await import('#/server/rooms/execution-engine')
        return getRoomSessionWindow({
            roomId: data.roomId,
            sessionKey: data.sessionKey,
            before: data.before ?? null,
            after: data.after ?? null,
            limitRows: data.limitRows ?? 40,
        })
    })

export const clearSessionCompletedBadgeServer = createServerFn({ method: 'POST' })
    .inputValidator((input: unknown) => sessionBadgeInputSchema.parse(input))
    .handler(async ({ data }) => {
        const { requireMutationActor, requireRoomOwner } = await loadRoomRuntimeRouteService()
        const actor = await requireMutationActor()
        await requireRoomOwner(actor, data.roomId)
        const { clearSessionCompletedBadge } = await import('#/server/rooms/execution-engine')
        await clearSessionCompletedBadge({
            roomId: data.roomId,
            sessionKey: data.sessionKey,
            actorUserId: actor.userId,
        })
        return {
            ok: true,
        }
    })

export const getSessionComposerDraftServer = createServerFn({ method: 'GET' })
    .inputValidator((input: unknown) => sessionComposerDraftInputSchema.parse(input))
    .handler(async ({ data }) => {
        const { getSessionComposerDraftForRoute } = await loadRoomRuntimeRouteService()
        return getSessionComposerDraftForRoute(data)
    })

export const saveSessionComposerDraftServer = createServerFn({ method: 'POST' })
    .inputValidator((input: unknown) => saveSessionComposerDraftInputSchema.parse(input))
    .handler(async ({ data }) => {
        const { saveSessionComposerDraftForRoute } = await loadRoomRuntimeRouteService()
        return saveSessionComposerDraftForRoute(data)
    })

export const recordClientPerformanceServer = createServerFn({ method: 'POST' })
    .inputValidator((input: unknown) => clientPerformanceInputSchema.parse(input))
    .handler(async ({ data }) => {
        const { requireAuthenticatedActor, requireRoomOwner } = await loadRoomRuntimeRouteService()
        const actor = await requireAuthenticatedActor()
        if (data.roomId) {
            await requireRoomOwner(actor, data.roomId)
        }
        const { logPerformanceEvent } = await import('#/server/telemetry/performance')
        logPerformanceEvent(data.name, {
            roomId: data.roomId ?? null,
            sessionKey: data.sessionKey ?? null,
            rowCount: data.rowCount ?? null,
            virtualRowCount: data.virtualRowCount ?? null,
            totalRows: data.totalRows ?? null,
            durationMs: data.durationMs ?? null,
            textLength: data.textLength ?? null,
            routePath: data.routePath ?? null,
            navigationType: data.navigationType ?? null,
        })
        return {
            ok: true,
        }
    })

export const sendMessageServer = createServerFn({ method: 'POST' })
    .inputValidator((input: unknown) => sendMessageInputSchema.parse(input))
    .handler(async ({ data }) => {
        const { sendMessageForRoute } = await loadRoomRuntimeRouteService()
        return sendMessageForRoute(data)
    })

const roomIdInputSchema = z.object({
    roomId: roomIdSchema,
})

export const getRoomPersonalityServer = createServerFn({ method: 'GET' })
    .inputValidator((input: unknown) => roomIdInputSchema.parse(input))
    .handler(async ({ data }) => {
        const { getRoomPersonalityForRoute } = await loadRoomRuntimeRouteService()
        return getRoomPersonalityForRoute(data)
    })

export const editMessageServer = createServerFn({ method: 'POST' })
    .inputValidator((input: unknown) => editMessageInputSchema.parse(input))
    .handler(async ({ data }) => {
        const { requireMutationActor, requireRoomOwner, ensureRuntimeSupervisorBoot } =
            await loadRoomRuntimeRouteService()
        const actor = await requireMutationActor()
        await requireRoomOwner(actor, data.roomId)
        await ensureRuntimeSupervisorBoot()
        const { editRoomThreadMessage } = await import('#/server/rooms/execution-engine')
        return editRoomThreadMessage({
            roomId: data.roomId,
            sessionKey: data.sessionKey,
            messageId: data.messageId,
            message: data.message,
        })
    })

export const updateThreadModelServer = createServerFn({ method: 'POST' })
    .inputValidator((input: unknown) => updateThreadModelInputSchema.parse(input))
    .handler(async ({ data }) => {
        const { requireMutationActor, requireRoomOwner, ensureRuntimeSupervisorBoot } =
            await loadRoomRuntimeRouteService()
        const actor = await requireMutationActor()
        await requireRoomOwner(actor, data.roomId)
        await ensureRuntimeSupervisorBoot()
        const { updateRoomThreadModel } = await import('#/server/rooms/execution-engine')
        return updateRoomThreadModel({
            roomId: data.roomId,
            sessionKey: data.sessionKey,
            provider: data.provider,
            model: data.model,
            thinkingLevel: data.thinkingLevel ?? null,
            speedMode: data.speedMode ?? null,
        })
    })

export const abortMessageServer = createServerFn({ method: 'POST' })
    .inputValidator((input: unknown) => abortMessageInputSchema.parse(input))
    .handler(async ({ data }) => {
        const { requireMutationActor, requireRoomOwner, ensureRuntimeSupervisorBoot } =
            await loadRoomRuntimeRouteService()
        const actor = await requireMutationActor()
        await requireRoomOwner(actor, data.roomId)
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
        const { createThreadForRoute } = await loadRoomRuntimeRouteService()
        return createThreadForRoute(data)
    })

export const listCronJobsServer = createServerFn({ method: 'GET' })
    .inputValidator((input: unknown) => listCronJobsInputSchema.parse(input))
    .handler(async ({ data }) => {
        const { requireAuthenticatedActor, requireRoomOwner, ensureRuntimeSupervisorBoot } =
            await loadRoomRuntimeRouteService()
        const actor = await requireAuthenticatedActor()
        setResponseHeaders({
            'cache-control': 'no-store',
        })
        await requireRoomOwner(actor, data.roomId)
        await ensureRuntimeSupervisorBoot()
        const { listRoomCronJobs } = await import('#/server/rooms/execution-engine')
        return listRoomCronJobs({
            roomId: data.roomId,
        })
    })

export const createCronJobServer = createServerFn({ method: 'POST' })
    .inputValidator((input: unknown) => createCronJobInputSchema.parse(input))
    .handler(async ({ data }) => {
        const { requireMutationActor, requireRoomOwner, ensureRuntimeSupervisorBoot } =
            await loadRoomRuntimeRouteService()
        const actor = await requireMutationActor()
        await requireRoomOwner(actor, data.roomId)
        await ensureRuntimeSupervisorBoot()
        const { createRoomCronJob } = await import('#/server/rooms/execution-engine')
        return createRoomCronJob({
            roomId: data.roomId,
            name: data.name,
            message: data.message,
            schedule: data.schedule,
        })
    })

export const updateCronJobServer = createServerFn({ method: 'POST' })
    .inputValidator((input: unknown) => updateCronJobInputSchema.parse(input))
    .handler(async ({ data }) => {
        const { requireMutationActor, requireRoomOwner, ensureRuntimeSupervisorBoot } =
            await loadRoomRuntimeRouteService()
        const actor = await requireMutationActor()
        await requireRoomOwner(actor, data.roomId)
        await ensureRuntimeSupervisorBoot()
        const { updateRoomCronJob } = await import('#/server/rooms/execution-engine')
        return updateRoomCronJob({
            roomId: data.roomId,
            jobId: data.jobId,
            name: data.name,
            message: data.message,
            schedule: data.schedule,
        })
    })

export const setCronEnabledServer = createServerFn({ method: 'POST' })
    .inputValidator((input: unknown) => setCronEnabledInputSchema.parse(input))
    .handler(async ({ data }) => {
        const { requireMutationActor, requireRoomOwner, ensureRuntimeSupervisorBoot } =
            await loadRoomRuntimeRouteService()
        const actor = await requireMutationActor()
        await requireRoomOwner(actor, data.roomId)
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
        const { requireMutationActor, requireRoomOwner, ensureRuntimeSupervisorBoot } =
            await loadRoomRuntimeRouteService()
        const actor = await requireMutationActor()
        await requireRoomOwner(actor, data.roomId)
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
        const { requireMutationActor, requireRoomOwner, ensureRuntimeSupervisorBoot } =
            await loadRoomRuntimeRouteService()
        const actor = await requireMutationActor()
        await requireRoomOwner(actor, data.roomId)
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
        const { requireMutationActor, requireRoomOwner, ensureRuntimeSupervisorBoot } =
            await loadRoomRuntimeRouteService()
        const actor = await requireMutationActor()
        await requireRoomOwner(actor, data.roomId)
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
        const { requireAuthenticatedActor, requireRoomOwner, ensureRuntimeSupervisorBoot } =
            await loadRoomRuntimeRouteService()
        const actor = await requireAuthenticatedActor()
        setResponseHeaders({
            'cache-control': 'no-store',
        })
        await requireRoomOwner(actor, data.roomId)
        await ensureRuntimeSupervisorBoot()
        const { getRoomExecutionTruthSnapshot } = await import('#/server/rooms/execution-engine')
        return getRoomExecutionTruthSnapshot({
            roomId: data.roomId,
        })
    })

export const listRoomUsageServer = createServerFn({ method: 'GET' })
    .inputValidator((input: unknown) => roomUsageInputSchema.parse(input))
    .handler(async ({ data }) => {
        const { listRoomUsageForRoute } = await loadRoomRuntimeRouteService()
        return listRoomUsageForRoute(data)
    })

export const listUsageServer = createServerFn({ method: 'GET' })
    .inputValidator((input: unknown) => usageInputSchema.parse(input ?? {}))
    .handler(async ({ data }) => {
        const { listUsageForRoute } = await loadRoomRuntimeRouteService()
        return listUsageForRoute(data)
    })

export const listRoomFilesServer = createServerFn({ method: 'GET' })
    .inputValidator((input: unknown) => roomFilesInputSchema.parse(input))
    .handler(async ({ data }) => {
        const { listRoomFilesForRoute } = await loadRoomRuntimeRouteService()
        return listRoomFilesForRoute(data)
    })

export const listRoomFileTreeServer = createServerFn({ method: 'GET' })
    .inputValidator((input: unknown) => roomFilesInputSchema.parse(input))
    .handler(async ({ data }) => {
        const { listRoomFileTreeForRoute } = await loadRoomRuntimeRouteService()
        return listRoomFileTreeForRoute(data)
    })

export const listRoomDirectoryServer = createServerFn({ method: 'GET' })
    .inputValidator((input: unknown) => listRoomDirectoryInputSchema.parse(input))
    .handler(async ({ data }) => {
        const { listRoomDirectoryForRoute } = await loadRoomRuntimeRouteService()
        return listRoomDirectoryForRoute(data)
    })

export const readRoomFileServer = createServerFn({ method: 'GET' })
    .inputValidator((input: unknown) => readRoomFileInputSchema.parse(input))
    .handler(async ({ data }) => {
        const { readRoomFileForRoute } = await loadRoomRuntimeRouteService()
        return readRoomFileForRoute(data)
    })

export const getRoomMemoryServer = createServerFn({ method: 'GET' })
    .inputValidator((input: unknown) => roomMemoryInputSchema.parse(input))
    .handler(async ({ data }) => {
        const { getRoomMemoryForRoute } = await loadRoomRuntimeRouteService()
        return getRoomMemoryForRoute(data)
    })

export const updateRoomMemoryServer = createServerFn({ method: 'POST' })
    .inputValidator((input: unknown) => updateRoomMemoryInputSchema.parse(input))
    .handler(async ({ data }) => {
        const { updateRoomMemoryForRoute } = await loadRoomRuntimeRouteService()
        return updateRoomMemoryForRoute(data)
    })

export const deleteRoomServer = createServerFn({ method: 'POST' })
    .inputValidator((input: unknown) => deleteRoomInputSchema.parse(input))
    .handler(async ({ data }) => {
        const { deleteRoomForRoute } = await loadRoomRuntimeRouteService()
        return deleteRoomForRoute(data)
    })

export const deleteSessionServer = createServerFn({ method: 'POST' })
    .inputValidator((input: unknown) => deleteSessionInputSchema.parse(input))
    .handler(async ({ data }) => {
        const { deleteSessionForRoute } = await loadRoomRuntimeRouteService()
        return deleteSessionForRoute(data)
    })

export const renameSessionServer = createServerFn({ method: 'POST' })
    .inputValidator((input: unknown) => renameSessionInputSchema.parse(input))
    .handler(async ({ data }) => {
        const { requireMutationActor, requireRoomOwner, ensureRuntimeSupervisorBoot } =
            await loadRoomRuntimeRouteService()
        const actor = await requireMutationActor()
        await requireRoomOwner(actor, data.roomId)
        await ensureRuntimeSupervisorBoot()
        const { renameRoomSession } = await import('#/server/rooms/execution-engine')
        await renameRoomSession({
            roomId: data.roomId,
            sessionKey: data.sessionKey,
            title: data.title,
        })
        return { ok: true }
    })
