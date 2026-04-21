import { createServerFn } from '@tanstack/react-start'
import { setResponseHeaders } from '@tanstack/react-start/server'
import { z } from 'zod'
import { roomDesiredStates } from '#/server/domain/types'

const roomExecutionInputSchema = z.object({
    roomId: z.string().min(1),
    selectedThreadKey: z.string().min(1).nullable().optional(),
})

const sendMessageInputSchema = z.object({
    roomId: z.string().min(1),
    sessionKey: z.string().min(1),
    message: z.string().min(1),
})

const abortMessageInputSchema = z.object({
    roomId: z.string().min(1),
    sessionKey: z.string().min(1),
    runId: z.string().min(1).nullable().optional(),
})

const createThreadInputSchema = z.object({
    roomId: z.string().min(1),
    firstMessage: z.string().nullable().optional(),
})

const listCronJobsInputSchema = z.object({
    roomId: z.string().min(1),
})

const createCronJobInputSchema = z.object({
    roomId: z.string().min(1),
    name: z.string().min(1),
    message: z.string().min(1),
    everyMinutes: z.number().int().positive(),
})

const setCronEnabledInputSchema = z.object({
    roomId: z.string().min(1),
    jobId: z.string().min(1),
    enabled: z.boolean(),
})

const runCronJobInputSchema = z.object({
    roomId: z.string().min(1),
    jobId: z.string().min(1),
})

const removeCronJobInputSchema = z.object({
    roomId: z.string().min(1),
    jobId: z.string().min(1),
})

const wakeRoomInputSchema = z.object({
    roomId: z.string().min(1),
    text: z.string().min(1),
    mode: z.enum(['now', 'next-heartbeat']).optional(),
})

const roomExecutionTruthInputSchema = z.object({
    roomId: z.string().min(1),
})

const roomRunHistoryInputSchema = z.object({
    roomId: z.string().min(1),
    limit: z.number().int().positive().max(200).optional(),
})

const roomFilesInputSchema = z.object({
    roomId: z.string().min(1),
})

const createRoomInputSchema = z.object({
    displayName: z.string().min(1),
    slug: z.string().min(1).nullable().optional(),
    startImmediately: z.boolean().optional(),
    instructions: z.string().optional(),
    providerMode: z.enum(['app_default', 'app_connection', 'room_secret']).optional(),
    providerConnectionId: z.string().uuid().nullable().optional(),
    provider: z.string().nullable().optional(),
    providerApi: z
        .enum([
            'openai-responses',
            'openai-completions',
            'openai-codex-responses',
            'anthropic-messages',
            'google-generative-ai',
        ])
        .nullable()
        .optional(),
    providerBaseUrl: z.string().nullable().optional(),
    providerModel: z.string().nullable().optional(),
    providerApiKey: z.string().optional(),
    toolsProfile: z.string().min(1).optional(),
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
