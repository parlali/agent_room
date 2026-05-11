import { createServerFn } from '@tanstack/react-start'
import { setResponseHeaders } from '@tanstack/react-start/server'
import { z } from 'zod'
import {
    mcpAuthModes,
    mcpTransports,
    providerApis,
    providerAuthModes,
    roomModes,
    roomProviderModes,
    roomSecretPurposes,
    capabilityIds,
} from '#/server/domain/types'

const providerConnectionInputSchema = z.object({
    id: z.string().uuid().optional(),
    label: z.string().min(1),
    provider: z.string().min(1),
    api: z.enum(providerApis),
    authMode: z.enum(providerAuthModes).optional(),
    baseUrl: z.string().nullable().optional(),
    defaultModel: z.string().min(1),
    fallbackModels: z.array(z.string().min(1)).default([]),
    apiKey: z.string().optional(),
    makeDefault: z.boolean().optional(),
})

const mcpConnectionInputSchema = z.object({
    id: z.string().uuid().optional(),
    name: z.string().min(1),
    serverKey: z.string().min(1),
    transport: z.enum(mcpTransports),
    command: z.string().nullable().optional(),
    argsText: z.string().optional(),
    url: z.string().nullable().optional(),
    headersText: z.string().optional(),
    authMode: z.enum(mcpAuthModes),
    bearerToken: z.string().optional(),
    allowedToolsText: z.string().optional(),
})

const connectionDeleteInputSchema = z.object({
    id: z.string().uuid(),
})

const appDefaultsInputSchema = z.object({
    defaultProviderConnectionId: z.string().uuid().nullable(),
    defaultModel: z.string().nullable(),
    onboardingCompleted: z.boolean(),
})

const appCapabilityInputSchema = z.object({
    capabilityDefaults: z.record(z.enum(capabilityIds), z.boolean()),
    search: z
        .object({
            enabled: z.boolean(),
            backendUrl: z.string().url(),
            defaultResultCount: z.number().int().positive().max(20),
            timeoutMs: z.number().int().positive().max(30000),
        })
        .optional(),
    image: z.object({
        provider: z.enum(['openai', 'gemini']).nullable(),
        model: z.string().nullable(),
        apiKey: z.string().optional(),
    }),
})

const roomConfigInputSchema = z.object({
    roomId: z.string().uuid(),
    instructions: z.string(),
    providerMode: z.enum(roomProviderModes),
    providerConnectionId: z.string().uuid().nullable().optional(),
    provider: z.string().nullable().optional(),
    providerApi: z.enum(providerApis).nullable().optional(),
    providerBaseUrl: z.string().nullable().optional(),
    providerModel: z.string().nullable().optional(),
    providerApiKey: z.string().optional(),
    roomMode: z.enum(roomModes),
    capabilityOverrides: z.record(z.string(), z.boolean()).default({}),
    imageProvider: z.enum(['openai', 'gemini']).nullable().optional(),
    imageModel: z.string().nullable().optional(),
    imageApiKey: z.string().optional(),
    cronTimezone: z.string().min(1),
    mcpConnectionIds: z.array(z.string().uuid()).default([]),
})

const roomSecretInputSchema = z.object({
    roomId: z.string().uuid(),
    label: z.string().min(1),
    envKey: z.string().min(1),
    purpose: z.enum(roomSecretPurposes),
    provider: z.string().nullable().optional(),
    value: z.string().min(1),
})

const roomConfigQuerySchema = z.object({
    roomId: z.string().uuid(),
})

const codexOAuthRoomInputSchema = z.object({
    roomId: z.string().uuid(),
})

const codexOAuthRedirectInputSchema = z.object({
    roomId: z.string().uuid(),
    redirectUrl: z.string().min(1),
})

async function requireAuthenticatedActor() {
    const { requireAuthenticatedActor: requireActor } = await import('#/server/auth/session-auth')
    return requireActor()
}

async function requireMutationActor() {
    const { assertSameOriginMutation } = await import('#/server/auth/session-auth')
    assertSameOriginMutation()
    return requireAuthenticatedActor()
}

export const getOperatorConfigServer = createServerFn({ method: 'GET' }).handler(async () => {
    await requireAuthenticatedActor()
    setResponseHeaders({
        'cache-control': 'no-store',
    })
    const { getOperatorConfigSnapshot } =
        await import('#/server/configuration/operator-configuration')
    return getOperatorConfigSnapshot()
})

export const saveProviderConnectionServer = createServerFn({ method: 'POST' })
    .inputValidator((input: unknown) => providerConnectionInputSchema.parse(input))
    .handler(async ({ data }) => {
        const actor = await requireMutationActor()
        const { saveProviderConnection } =
            await import('#/server/configuration/operator-configuration')
        return saveProviderConnection(data, actor.userId)
    })

export const saveMcpConnectionServer = createServerFn({ method: 'POST' })
    .inputValidator((input: unknown) => mcpConnectionInputSchema.parse(input))
    .handler(async ({ data }) => {
        const actor = await requireMutationActor()
        const { saveMcpConnection } = await import('#/server/configuration/operator-configuration')
        return saveMcpConnection(data, actor.userId)
    })

export const deleteProviderConnectionServer = createServerFn({ method: 'POST' })
    .inputValidator((input: unknown) => connectionDeleteInputSchema.parse(input))
    .handler(async ({ data }) => {
        const actor = await requireMutationActor()
        const { deleteProviderConnection } =
            await import('#/server/configuration/operator-configuration')
        return deleteProviderConnection({
            id: data.id,
            actorUserId: actor.userId,
        })
    })

export const deleteMcpConnectionServer = createServerFn({ method: 'POST' })
    .inputValidator((input: unknown) => connectionDeleteInputSchema.parse(input))
    .handler(async ({ data }) => {
        const actor = await requireMutationActor()
        const { deleteMcpConnection } =
            await import('#/server/configuration/operator-configuration')
        return deleteMcpConnection({
            id: data.id,
            actorUserId: actor.userId,
        })
    })

export const updateAppDefaultsServer = createServerFn({ method: 'POST' })
    .inputValidator((input: unknown) => appDefaultsInputSchema.parse(input))
    .handler(async ({ data }) => {
        const actor = await requireMutationActor()
        const { updateAppDefaults } = await import('#/server/configuration/operator-configuration')
        return updateAppDefaults({
            ...data,
            actorUserId: actor.userId,
        })
    })

export const updateAppCapabilitySettingsServer = createServerFn({ method: 'POST' })
    .inputValidator((input: unknown) => appCapabilityInputSchema.parse(input))
    .handler(async ({ data }) => {
        const actor = await requireMutationActor()
        const { updateAppCapabilitySettings } =
            await import('#/server/configuration/operator-configuration')
        return updateAppCapabilitySettings({
            ...data,
            actorUserId: actor.userId,
        })
    })

export const getRoomConfigServer = createServerFn({ method: 'GET' })
    .inputValidator((input: unknown) => roomConfigQuerySchema.parse(input))
    .handler(async ({ data }) => {
        await requireAuthenticatedActor()
        setResponseHeaders({
            'cache-control': 'no-store',
        })
        const { getRoomConfigSnapshot } =
            await import('#/server/configuration/operator-configuration')
        return getRoomConfigSnapshot(data.roomId)
    })

export const saveRoomConfigServer = createServerFn({ method: 'POST' })
    .inputValidator((input: unknown) => roomConfigInputSchema.parse(input))
    .handler(async ({ data }) => {
        const actor = await requireMutationActor()
        const { saveRoomConfig } = await import('#/server/configuration/operator-configuration')
        return saveRoomConfig(data, actor.userId)
    })

export const saveRoomSecretServer = createServerFn({ method: 'POST' })
    .inputValidator((input: unknown) => roomSecretInputSchema.parse(input))
    .handler(async ({ data }) => {
        const actor = await requireMutationActor()
        const { saveRoomSecret } = await import('#/server/configuration/operator-configuration')
        return saveRoomSecret(data, actor.userId)
    })

export const getCodexOAuthSessionServer = createServerFn({ method: 'GET' })
    .inputValidator((input: unknown) => codexOAuthRoomInputSchema.parse(input))
    .handler(async ({ data }) => {
        await requireAuthenticatedActor()
        setResponseHeaders({
            'cache-control': 'no-store',
        })
        const { getCodexOAuthSessionSnapshot } =
            await import('#/server/configuration/codex-oauth-flow')
        return getCodexOAuthSessionSnapshot(data.roomId)
    })

export const startCodexOAuthSessionServer = createServerFn({ method: 'POST' })
    .inputValidator((input: unknown) => codexOAuthRoomInputSchema.parse(input))
    .handler(async ({ data }) => {
        const actor = await requireMutationActor()
        const { startCodexOAuthSession } = await import('#/server/configuration/codex-oauth-flow')
        return startCodexOAuthSession(data.roomId, actor.userId)
    })

export const submitCodexOAuthRedirectServer = createServerFn({ method: 'POST' })
    .inputValidator((input: unknown) => codexOAuthRedirectInputSchema.parse(input))
    .handler(async ({ data }) => {
        const actor = await requireMutationActor()
        const { submitCodexOAuthRedirect } = await import('#/server/configuration/codex-oauth-flow')
        return submitCodexOAuthRedirect({
            roomId: data.roomId,
            redirectUrl: data.redirectUrl,
            actorUserId: actor.userId,
        })
    })

export const cancelCodexOAuthSessionServer = createServerFn({ method: 'POST' })
    .inputValidator((input: unknown) => codexOAuthRoomInputSchema.parse(input))
    .handler(async ({ data }) => {
        const actor = await requireMutationActor()
        const { cancelCodexOAuthSession } = await import('#/server/configuration/codex-oauth-flow')
        return cancelCodexOAuthSession({
            roomId: data.roomId,
            actorUserId: actor.userId,
        })
    })
