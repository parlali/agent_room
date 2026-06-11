import { createServerFn } from '@tanstack/react-start'
import { setResponseHeaders } from '@tanstack/react-start/server'
import { z } from 'zod'
import {
    mcpAuthModes,
    mcpTransports,
    roomModes,
    roomProviderModes,
    userRoomSecretPurposes,
    capabilityIds,
    searchSafeSearchValues,
} from '#/domain/domain-types'

const providerConnectionInputSchema = z.object({
    id: z.string().uuid().optional(),
    label: z.string().min(1),
    provider: z.string().min(1),
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
            maxSearchesPerRun: z.number().int().positive().max(100),
            brave: z.object({
                enabled: z.boolean(),
                country: z.string().nullable(),
                searchLang: z.string().nullable(),
                safeSearch: z.enum(searchSafeSearchValues),
                timeoutMs: z.number().int().positive().max(30000),
                resultCount: z.number().int().positive().max(20),
                apiKey: z.string().optional(),
            }),
            browserbase: z.object({
                enabled: z.boolean(),
                timeoutMs: z.number().int().positive().max(30000),
                resultCount: z.number().int().positive().max(20),
                apiKey: z.string().optional(),
            }),
        })
        .optional(),
    image: z.object({
        provider: z.enum(['openai', 'gemini']).nullable(),
        model: z.string().nullable(),
        apiKey: z.string().optional(),
    }),
})

const githubAppManifestStartInputSchema = z.object({
    publicOrigin: z.string().url(),
    targetOwner: z.string().nullable().optional(),
})

const githubAppManifestCompleteInputSchema = z.object({
    code: z.string().min(1),
    state: z.string().min(1),
})

const githubInstallationQuerySchema = z.object({
    installationId: z.string().min(1),
    query: z.string().optional(),
    page: z.number().int().positive().optional(),
    pageSize: z.number().int().positive().max(50).optional(),
})

const roomConfigInputSchema = z.object({
    roomId: z.string().uuid(),
    instructions: z.string(),
    providerMode: z.enum(roomProviderModes),
    providerConnectionId: z.string().uuid().nullable().optional(),
    roomMode: z.enum(roomModes),
    capabilityOverrides: z.record(z.string(), z.boolean()).default({}),
    imageProvider: z.enum(['openai', 'gemini']).nullable().optional(),
    imageModel: z.string().nullable().optional(),
    imageApiKey: z.string().optional(),
    cronTimezone: z.string().min(1),
    mcpConnectionIds: z.array(z.string().uuid()).default([]),
    githubEnabled: z.boolean().default(false),
    githubInstallationId: z.string().nullable().optional(),
    githubRepositories: z.array(z.string().min(1)).default([]),
})

const roomSecretInputSchema = z.object({
    roomId: z.string().uuid(),
    label: z.string().min(1),
    envKey: z.string().min(1),
    purpose: z.enum(userRoomSecretPurposes),
    provider: z.string().nullable().optional(),
    value: z.string().min(1),
})

const roomConfigQuerySchema = z.object({
    roomId: z.string().uuid(),
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

export const startGitHubAppManifestServer = createServerFn({ method: 'POST' })
    .inputValidator((input: unknown) => githubAppManifestStartInputSchema.parse(input))
    .handler(async ({ data }) => {
        const actor = await requireMutationActor()
        const { startGitHubAppManifest } =
            await import('#/server/configuration/operator-configuration')
        return startGitHubAppManifest({
            publicOrigin: data.publicOrigin,
            targetOwner: data.targetOwner,
            actorUserId: actor.userId,
        })
    })

export const completeGitHubAppManifestServer = createServerFn({ method: 'POST' })
    .inputValidator((input: unknown) => githubAppManifestCompleteInputSchema.parse(input))
    .handler(async ({ data }) => {
        const actor = await requireMutationActor()
        const { completeGitHubAppManifest } =
            await import('#/server/configuration/operator-configuration')
        return completeGitHubAppManifest({
            code: data.code,
            state: data.state,
            actorUserId: actor.userId,
        })
    })

export const completeGitHubCallbackServer = createServerFn({ method: 'POST' })
    .inputValidator((input: unknown) => githubAppManifestCompleteInputSchema.parse(input))
    .handler(async ({ data }) => {
        const actor = await requireMutationActor()
        const { completeGitHubCallback } =
            await import('#/server/configuration/operator-configuration')
        return completeGitHubCallback({
            code: data.code,
            state: data.state,
            actorUserId: actor.userId,
        })
    })

export const startGitHubUserAuthorizationServer = createServerFn({ method: 'POST' })
    .inputValidator((input: unknown) =>
        githubAppManifestStartInputSchema
            .pick({
                publicOrigin: true,
            })
            .parse(input),
    )
    .handler(async ({ data }) => {
        const actor = await requireMutationActor()
        const { startGitHubUserAuthorization } =
            await import('#/server/configuration/operator-configuration')
        return startGitHubUserAuthorization({
            publicOrigin: data.publicOrigin,
            actorUserId: actor.userId,
        })
    })

export const refreshGitHubInstallationsServer = createServerFn({ method: 'POST' }).handler(
    async () => {
        const actor = await requireMutationActor()
        const { refreshGitHubInstallations } =
            await import('#/server/configuration/operator-configuration')
        return refreshGitHubInstallations(actor.userId)
    },
)

export const disconnectGitHubUserAuthorizationServer = createServerFn({
    method: 'POST',
}).handler(async () => {
    const actor = await requireMutationActor()
    const { disconnectGitHubUserAuthorization } =
        await import('#/server/configuration/operator-configuration')
    return disconnectGitHubUserAuthorization(actor.userId)
})

export const resetGitHubAppConfigurationServer = createServerFn({ method: 'POST' }).handler(
    async () => {
        const actor = await requireMutationActor()
        const { resetGitHubAppConfiguration } =
            await import('#/server/configuration/operator-configuration')
        return resetGitHubAppConfiguration(actor.userId)
    },
)

export const listGitHubInstallationRepositoriesServer = createServerFn({ method: 'GET' })
    .inputValidator((input: unknown) => githubInstallationQuerySchema.parse(input))
    .handler(async ({ data }) => {
        await requireAuthenticatedActor()
        setResponseHeaders({
            'cache-control': 'no-store',
        })
        const { listGitHubInstallationRepositories } =
            await import('#/server/configuration/operator-configuration')
        return listGitHubInstallationRepositories({
            installationId: data.installationId,
            query: data.query,
            page: data.page,
            pageSize: data.pageSize,
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

export const getCodexDeviceAuthSessionServer = createServerFn({ method: 'GET' }).handler(
    async () => {
        await requireAuthenticatedActor()
        setResponseHeaders({
            'cache-control': 'no-store',
        })
        const { getCodexDeviceAuthSessionSnapshot } =
            await import('#/server/configuration/operator-configuration')
        return getCodexDeviceAuthSessionSnapshot()
    },
)

export const startCodexDeviceAuthSessionServer = createServerFn({ method: 'POST' }).handler(
    async () => {
        const actor = await requireMutationActor()
        const { startCodexDeviceAuthSession } =
            await import('#/server/configuration/operator-configuration')
        return startCodexDeviceAuthSession(actor.userId)
    },
)

export const cancelCodexDeviceAuthSessionServer = createServerFn({ method: 'POST' }).handler(
    async () => {
        const actor = await requireMutationActor()
        const { cancelCodexDeviceAuthSession } =
            await import('#/server/configuration/operator-configuration')
        return cancelCodexDeviceAuthSession({
            actorUserId: actor.userId,
        })
    },
)
