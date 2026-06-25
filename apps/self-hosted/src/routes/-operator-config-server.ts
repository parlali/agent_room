import { createServerFn } from '@tanstack/react-start'
import { setResponseHeaders } from '@tanstack/react-start/server'
import { z } from 'zod'
import {
    appCapabilitySettingsSaveSchema,
    appDefaultsSaveSchema,
    mcpSaveSchema,
    providerSaveSchema,
    roomConfigSaveSchema,
    roomSecretSaveSchema,
} from '#/server/configuration/operator-configuration/contracts'
import {
    getHostedOperatorConfigSnapshot,
    getHostedRoomConfigSnapshot,
    saveHostedRoomConfig,
    saveHostedRoomSecret,
} from '#/server/cloudflare/hosted-room-service'
import {
    deleteHostedMcpConnection,
    deleteHostedProviderConnection,
    saveHostedMcpConnection,
    saveHostedProviderConnection,
    updateHostedAppCapabilitySettings,
    updateHostedAppDefaults,
} from '#/server/cloudflare/hosted-operator-config-write-service'
import {
    requireHostedActor,
    requireHostedMutationActor,
} from '#/server/cloudflare/hosted-route-auth'

const connectionDeleteInputSchema = z.object({
    id: z.string().uuid(),
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

const roomConfigQuerySchema = z.object({
    roomId: z.string().uuid(),
})

async function rejectHostedGitHubAppSetup() {
    if (await requireHostedMutationActor()) {
        throw new Error('Hosted GitHub app setup is not available in this hosted runtime')
    }
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

export const getOperatorConfigServer = createServerFn({ method: 'GET' }).handler(async () => {
    const hosted = await requireHostedActor()
    if (hosted) {
        setResponseHeaders({
            'cache-control': 'no-store',
        })
        return getHostedOperatorConfigSnapshot({
            env: hosted.context.env,
            actor: hosted.actor,
        })
    }
    await requireAuthenticatedActor()
    setResponseHeaders({
        'cache-control': 'no-store',
    })
    const { getOperatorConfigSnapshot } =
        await import('#/server/configuration/operator-configuration')
    return getOperatorConfigSnapshot()
})

export const saveProviderConnectionServer = createServerFn({ method: 'POST' })
    .inputValidator((input: unknown) => providerSaveSchema.parse(input))
    .handler(async ({ data }) => {
        const hosted = await requireHostedMutationActor()
        if (hosted) {
            return saveHostedProviderConnection({
                env: hosted.context.env,
                actor: hosted.actor,
                data,
            })
        }
        const actor = await requireMutationActor()
        const { saveProviderConnection } =
            await import('#/server/configuration/operator-configuration')
        return saveProviderConnection(data, actor.userId)
    })

export const saveMcpConnectionServer = createServerFn({ method: 'POST' })
    .inputValidator((input: unknown) => mcpSaveSchema.parse(input))
    .handler(async ({ data }) => {
        const hosted = await requireHostedMutationActor()
        if (hosted) {
            return saveHostedMcpConnection({
                env: hosted.context.env,
                actor: hosted.actor,
                data,
            })
        }
        const actor = await requireMutationActor()
        const { saveMcpConnection } = await import('#/server/configuration/operator-configuration')
        return saveMcpConnection(data, actor.userId)
    })

export const deleteProviderConnectionServer = createServerFn({ method: 'POST' })
    .inputValidator((input: unknown) => connectionDeleteInputSchema.parse(input))
    .handler(async ({ data }) => {
        const hosted = await requireHostedMutationActor()
        if (hosted) {
            return deleteHostedProviderConnection({
                env: hosted.context.env,
                actor: hosted.actor,
                id: data.id,
            })
        }
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
        const hosted = await requireHostedMutationActor()
        if (hosted) {
            return deleteHostedMcpConnection({
                env: hosted.context.env,
                actor: hosted.actor,
                id: data.id,
            })
        }
        const actor = await requireMutationActor()
        const { deleteMcpConnection } =
            await import('#/server/configuration/operator-configuration')
        return deleteMcpConnection({
            id: data.id,
            actorUserId: actor.userId,
        })
    })

export const updateAppDefaultsServer = createServerFn({ method: 'POST' })
    .inputValidator((input: unknown) => appDefaultsSaveSchema.parse(input))
    .handler(async ({ data }) => {
        const hosted = await requireHostedMutationActor()
        if (hosted) {
            return updateHostedAppDefaults({
                env: hosted.context.env,
                actor: hosted.actor,
                data,
            })
        }
        const actor = await requireMutationActor()
        const { updateAppDefaults } = await import('#/server/configuration/operator-configuration')
        return updateAppDefaults({
            ...data,
            actorUserId: actor.userId,
        })
    })

export const updateAppCapabilitySettingsServer = createServerFn({ method: 'POST' })
    .inputValidator((input: unknown) => appCapabilitySettingsSaveSchema.parse(input))
    .handler(async ({ data }) => {
        const hosted = await requireHostedMutationActor()
        if (hosted) {
            return updateHostedAppCapabilitySettings({
                env: hosted.context.env,
                actor: hosted.actor,
                data,
            })
        }
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
        await rejectHostedGitHubAppSetup()
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
        await rejectHostedGitHubAppSetup()
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
        await rejectHostedGitHubAppSetup()
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
        await rejectHostedGitHubAppSetup()
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
        await rejectHostedGitHubAppSetup()
        const actor = await requireMutationActor()
        const { refreshGitHubInstallations } =
            await import('#/server/configuration/operator-configuration')
        return refreshGitHubInstallations(actor.userId)
    },
)

export const disconnectGitHubUserAuthorizationServer = createServerFn({
    method: 'POST',
}).handler(async () => {
    await rejectHostedGitHubAppSetup()
    const actor = await requireMutationActor()
    const { disconnectGitHubUserAuthorization } =
        await import('#/server/configuration/operator-configuration')
    return disconnectGitHubUserAuthorization(actor.userId)
})

export const resetGitHubAppConfigurationServer = createServerFn({ method: 'POST' }).handler(
    async () => {
        await rejectHostedGitHubAppSetup()
        const actor = await requireMutationActor()
        const { resetGitHubAppConfiguration } =
            await import('#/server/configuration/operator-configuration')
        return resetGitHubAppConfiguration(actor.userId)
    },
)

export const listGitHubInstallationRepositoriesServer = createServerFn({ method: 'GET' })
    .inputValidator((input: unknown) => githubInstallationQuerySchema.parse(input))
    .handler(async ({ data }) => {
        if (await requireHostedActor()) {
            return {
                repositories: [],
                totalCount: 0,
                scannedCount: 0,
                hasMore: false,
                nextPage: null,
                query: data.query ?? '',
            }
        }
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
        const hosted = await requireHostedActor()
        if (hosted) {
            setResponseHeaders({
                'cache-control': 'no-store',
            })
            return getHostedRoomConfigSnapshot({
                env: hosted.context.env,
                actor: hosted.actor,
                roomId: data.roomId,
            })
        }
        const actor = await requireAuthenticatedActor()
        setResponseHeaders({
            'cache-control': 'no-store',
        })
        const { requireRoomOwner } = await import('#/server/rooms/room-runtime-route-service')
        await requireRoomOwner(actor, data.roomId)
        const { getRoomConfigSnapshot } =
            await import('#/server/configuration/operator-configuration')
        return getRoomConfigSnapshot(data.roomId)
    })

export const saveRoomConfigServer = createServerFn({ method: 'POST' })
    .inputValidator((input: unknown) => roomConfigSaveSchema.parse(input))
    .handler(async ({ data }) => {
        const hosted = await requireHostedMutationActor()
        if (hosted) {
            return saveHostedRoomConfig({
                env: hosted.context.env,
                actor: hosted.actor,
                data,
            })
        }
        const actor = await requireMutationActor()
        const { requireRoomOwner } = await import('#/server/rooms/room-runtime-route-service')
        await requireRoomOwner(actor, data.roomId)
        const { saveRoomConfig } = await import('#/server/configuration/operator-configuration')
        return saveRoomConfig(data, actor.userId)
    })

export const saveRoomSecretServer = createServerFn({ method: 'POST' })
    .inputValidator((input: unknown) => roomSecretSaveSchema.parse(input))
    .handler(async ({ data }) => {
        const hosted = await requireHostedMutationActor()
        if (hosted) {
            return saveHostedRoomSecret({
                env: hosted.context.env,
                actor: hosted.actor,
                data,
            })
        }
        const actor = await requireMutationActor()
        const { requireRoomOwner } = await import('#/server/rooms/room-runtime-route-service')
        await requireRoomOwner(actor, data.roomId)
        const { saveRoomSecret } = await import('#/server/configuration/operator-configuration')
        return saveRoomSecret(data, actor.userId)
    })

export const getCodexDeviceAuthSessionServer = createServerFn({ method: 'GET' }).handler(
    async () => {
        const hosted = await requireHostedActor()
        if (hosted) {
            const config = await getHostedOperatorConfigSnapshot({
                env: hosted.context.env,
                actor: hosted.actor,
            })
            return {
                status: 'idle',
                verificationUrl: null,
                userCode: null,
                message:
                    config.codexAuth.message === 'Codex app server login is missing'
                        ? 'Hosted Codex requires saving a Codex auth JSON credential on the Codex provider connection'
                        : config.codexAuth.message,
                startedAt: null,
                updatedAt: null,
                completedAt: null,
                auth: config.codexAuth,
            }
        }
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
        if (await requireHostedMutationActor()) {
            throw new Error(
                'Hosted Codex device authorization cannot spawn a local Codex CLI process',
            )
        }
        const actor = await requireMutationActor()
        const { startCodexDeviceAuthSession } =
            await import('#/server/configuration/operator-configuration')
        return startCodexDeviceAuthSession(actor.userId)
    },
)

export const cancelCodexDeviceAuthSessionServer = createServerFn({ method: 'POST' }).handler(
    async () => {
        const hosted = await requireHostedMutationActor()
        if (hosted) {
            const config = await getHostedOperatorConfigSnapshot({
                env: hosted.context.env,
                actor: hosted.actor,
            })
            return {
                status: 'cancelled',
                verificationUrl: null,
                userCode: null,
                message: config.codexAuth.message,
                startedAt: null,
                updatedAt: new Date().toISOString(),
                completedAt: new Date().toISOString(),
                auth: config.codexAuth,
            }
        }
        const actor = await requireMutationActor()
        const { cancelCodexDeviceAuthSession } =
            await import('#/server/configuration/operator-configuration')
        return cancelCodexDeviceAuthSession({
            actorUserId: actor.userId,
        })
    },
)
