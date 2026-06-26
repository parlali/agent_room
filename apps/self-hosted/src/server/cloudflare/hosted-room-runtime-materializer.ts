import type { MaterializedRoomConfiguration } from '#/domain/domain-types'
import { hostedPlanAllowsManagedBrowserbase } from '@agent-room/billing'
import {
    mergeCapabilities,
    normalizeBudgets,
    normalizeImageConfig,
    normalizeSearchConfig,
    searchProviderSecretId,
} from '../configuration/capabilities'
import { upperSnake } from '../configuration/provider-config'
import {
    imageConfigSecretId,
    imageProviderEnvKey,
} from '../configuration/operator-configuration/helpers'
import { buildPiRuntimeConfig } from '../rooms/pi-runtime-config'
import {
    hostedRuntimeUsageCallbackTokenEnvKey,
    hostedRuntimeQuotaCallbackUrlEnvKey,
    hostedRuntimeUsageCallbackUrlEnvKey,
} from '../rooms/pi-runtime-contract'
import { assertNoReservedRoomRuntimeEnvKeys } from '../security/process-env'
import type { AgentRoomHostedEnv } from './bindings'
import type { HostedActor } from './hosted-auth'
import { resolveHostedConfig } from './hosted-config'
import { nowIso } from './hosted-json'
import {
    getOrCreateHostedRoomConfig,
    listRoomMcpBindings,
    listRoomSecrets,
} from './hosted-room-config-store'
import { getHostedRoom, getHostedRuntimeState } from './hosted-room-store'
import { putHostedRuntimeArtifact } from './hosted-runtime-artifacts'
import { listHostedRuntimeStateFileMaterializations } from './hosted-runtime-state-store'
import {
    buildHostedRuntimeEnv,
    type HostedRuntimeMaterialization,
    hostedRuntimeAllowedHosts,
    hostedRuntimeRedactionSecrets,
    hostedSandbox,
    hostedSandboxHardening,
    materializeHostedMcpServers,
    materializeHostedProvider,
    randomHostedRuntimeToken,
    runtimeFileBundle,
} from './hosted-runtime-materialization'
import {
    hostedProviderAuthPath,
    hostedRoomPaths,
    hostedRuntimeConfigPath,
    hostedRuntimePort,
} from './hosted-runtime-paths'
import {
    hostedBraveProxyBaseUrl,
    hostedBrowserbaseProxyBaseUrl,
    hostedManagedFetchProxyUrl,
} from './hosted-provider-proxy'
import { ensureHostedBillingAccount } from './hosted-billing-repository'
import { isHostedBillingPlanStatusActive } from './hosted-billing-types'
import {
    getHostedWorkspaceSettings,
    hostedSearchDefaults,
    listHostedMcp,
    listHostedProviders,
    materializedImageConfig,
    materializedSearchConfig,
    readRequiredHostedSecretPlainText,
} from './hosted-operator-config-service'
import {
    hostedRuntimeBundleKey,
    hostedRuntimeConfigKey,
    hostedRuntimeTokenKey,
} from './workspace-storage'
import { deleteHostedWorkspaceObjects } from './hosted-workspace-objects'

export class HostedRuntimeMaterializationConflictError extends Error {
    constructor() {
        super('Hosted runtime materialization was superseded by another state transition')
        this.name = 'HostedRuntimeMaterializationConflictError'
    }
}

async function deleteSupersededRuntimeArtifacts(input: {
    env: AgentRoomHostedEnv
    keys: string[]
}): Promise<void> {
    try {
        await deleteHostedWorkspaceObjects(input)
    } catch (error) {
        console.warn(
            'Failed to delete superseded hosted runtime artifacts',
            error instanceof Error ? error.message : error,
        )
    }
}

export async function materializeHostedRuntime(input: {
    env: AgentRoomHostedEnv
    actor: Pick<HostedActor, 'workspaceId' | 'userId'>
    roomId: string
}): Promise<HostedRuntimeMaterialization> {
    const [room, config, settings, providers, mcpConnections, bindings, runtimeState, roomSecrets] =
        await Promise.all([
            getHostedRoom({
                env: input.env,
                workspaceId: input.actor.workspaceId,
                roomId: input.roomId,
            }),
            getOrCreateHostedRoomConfig({
                env: input.env,
                workspaceId: input.actor.workspaceId,
                roomId: input.roomId,
            }),
            getHostedWorkspaceSettings({
                env: input.env,
                workspaceId: input.actor.workspaceId,
            }),
            listHostedProviders({
                env: input.env,
                workspaceId: input.actor.workspaceId,
            }),
            listHostedMcp({
                env: input.env,
                workspaceId: input.actor.workspaceId,
            }),
            listRoomMcpBindings({
                env: input.env,
                workspaceId: input.actor.workspaceId,
                roomId: input.roomId,
            }),
            getHostedRuntimeState({
                env: input.env,
                workspaceId: input.actor.workspaceId,
                roomId: input.roomId,
            }),
            listRoomSecrets({
                env: input.env,
                workspaceId: input.actor.workspaceId,
                roomId: input.roomId,
            }),
        ])
    if (!room) {
        throw new Error('Room not found')
    }
    if (!runtimeState) {
        throw new Error('Runtime state not found')
    }
    const previousTokenObjectKey = runtimeState.row.tokenObjectKey
    const token = randomHostedRuntimeToken()
    const publicOrigin = new URL(input.env.BETTER_AUTH_URL).origin
    const providerMaterialization = await materializeHostedProvider({
        env: input.env,
        workspaceId: input.actor.workspaceId,
        roomId: input.roomId,
        runtimeToken: token,
        publicOrigin,
        config,
        settings,
        providers,
    })
    const enabledBindings = bindings.filter((binding) => binding.enabled)
    const capabilities = mergeCapabilities({
        defaults: settings.capabilityDefaults,
        overrides: config.capabilityOverrides,
        roomMode: config.roomMode,
        mcpConnectionCount: enabledBindings.length,
    })
    const search = normalizeSearchConfig(settings.searchConfig, hostedSearchDefaults)
    const searchEnabled = search.enabled && capabilities.webSearch
    const env: Record<string, string> = { ...providerMaterialization.env }
    const braveSecretId = searchProviderSecretId({
        config: settings.searchConfig,
        provider: 'brave',
    })
    const managedBraveSearch = searchEnabled && search.brave.enabled && !braveSecretId
    if (searchEnabled && search.brave.enabled) {
        if (braveSecretId) {
            env.AGENT_ROOM_SEARCH_BRAVE_API_KEY = await readRequiredHostedSecretPlainText({
                env: input.env,
                workspaceId: input.actor.workspaceId,
                secretId: braveSecretId,
                label: 'Brave search credential',
            })
        } else {
            const managedBraveApiKey = resolveHostedConfig(input.env).managedProviders.braveApiKey
            if (!managedBraveApiKey) {
                throw new Error('Managed Brave search is not configured')
            }
            env.AGENT_ROOM_SEARCH_BRAVE_API_KEY = token
        }
    }
    const browserbaseSecretId = searchProviderSecretId({
        config: settings.searchConfig,
        provider: 'browserbase',
    })
    const managedBrowserbase = searchEnabled && search.browserbase.enabled && !browserbaseSecretId
    if (searchEnabled && search.browserbase.enabled) {
        if (browserbaseSecretId) {
            env.AGENT_ROOM_SEARCH_BROWSERBASE_API_KEY = await readRequiredHostedSecretPlainText({
                env: input.env,
                workspaceId: input.actor.workspaceId,
                secretId: browserbaseSecretId,
                label: 'Browserbase search credential',
            })
        } else {
            const hostedConfig = resolveHostedConfig(input.env)
            if (!hostedConfig.managedProviders.browserbaseApiKey) {
                throw new Error('Managed Browserbase is not configured')
            }
            const billingAccount = await ensureHostedBillingAccount({
                env: input.env,
                workspaceId: input.actor.workspaceId,
            })
            if (
                !isHostedBillingPlanStatusActive(billingAccount.planStatus) ||
                !hostedPlanAllowsManagedBrowserbase(billingAccount.planKey)
            ) {
                throw new Error('Managed Browserbase requires an active Pro plan')
            }
            env.AGENT_ROOM_SEARCH_BROWSERBASE_API_KEY = token
        }
    }
    const appImage = normalizeImageConfig({
        appConfig: settings.imageConfig,
        roomProvider: null,
        roomModel: null,
        envKey: null,
    })
    const imageSecretId = config.imageProvider
        ? config.imageSecretId
        : imageConfigSecretId(settings.imageConfig)
    const imageProvider = config.imageProvider ?? appImage.provider
    const imageEnvKeyName = imageProvider ? imageProviderEnvKey(imageProvider) : null
    if (imageEnvKeyName && imageSecretId) {
        const imageSecret = await readRequiredHostedSecretPlainText({
            env: input.env,
            workspaceId: input.actor.workspaceId,
            secretId: imageSecretId,
            label: `${imageProvider} image credential`,
        })
        env[imageEnvKeyName] = imageSecret
    }
    const usedRuntimeEnvKeys = new Set(Object.keys(env).map((key) => upperSnake(key)))
    for (const roomSecret of roomSecrets) {
        const envKey = upperSnake(roomSecret.envKey)
        if (!envKey) {
            throw new Error(`Room secret ${roomSecret.label} has an empty env key`)
        }
        assertNoReservedRoomRuntimeEnvKeys(
            {
                [envKey]: 'reserved-check',
            },
            'Room secret env key',
        )
        if (usedRuntimeEnvKeys.has(envKey)) {
            throw new Error(`Room secret env key ${envKey} conflicts with materialized config`)
        }
        const plainText = await readRequiredHostedSecretPlainText({
            env: input.env,
            workspaceId: input.actor.workspaceId,
            secretId: roomSecret.secretId,
            label: `Room secret ${roomSecret.label}`,
        })
        env[envKey] = plainText
        usedRuntimeEnvKeys.add(envKey)
    }
    const mcpServers = await materializeHostedMcpServers({
        env: input.env,
        workspaceId: input.actor.workspaceId,
        mcpConnections,
        bindings: enabledBindings,
    })
    const roomConfiguration: MaterializedRoomConfiguration = {
        instructions: config.instructions,
        roomMode: config.roomMode,
        capabilities,
        search: materializedSearchConfig({
            settings,
            enabled: searchEnabled,
            braveApiKeyAvailable: Boolean(env.AGENT_ROOM_SEARCH_BRAVE_API_KEY),
            braveBaseUrl: managedBraveSearch
                ? hostedBraveProxyBaseUrl({
                      publicOrigin,
                      workspaceId: input.actor.workspaceId,
                      roomId: input.roomId,
                  })
                : null,
            browserbaseApiKeyAvailable: Boolean(env.AGENT_ROOM_SEARCH_BROWSERBASE_API_KEY),
            browserbaseBaseUrl: managedBrowserbase
                ? hostedBrowserbaseProxyBaseUrl({
                      publicOrigin,
                      workspaceId: input.actor.workspaceId,
                      roomId: input.roomId,
                  })
                : null,
        }),
        urlFetch: {
            mode: 'managed',
            proxyUrl: hostedManagedFetchProxyUrl({
                publicOrigin,
                workspaceId: input.actor.workspaceId,
                roomId: input.roomId,
            }),
            tokenEnvKey: hostedRuntimeUsageCallbackTokenEnvKey,
        },
        image: materializedImageConfig({
            settings,
            config,
            envKey: imageEnvKeyName && env[imageEnvKeyName] ? imageEnvKeyName : null,
        }),
        budgets: {
            ...normalizeBudgets(),
            browserActionsPerTurn: config.browserActionBudget,
        },
        provider: providerMaterialization.provider,
        entitlements: {
            env,
            internalEnv: {},
            secretRefs: [],
            mcpServers: capabilities.mcp ? mcpServers : [],
            github: {
                enabled: false,
                installationId: null,
                accountLogin: null,
                repositories: [],
                tokenEnvKey: null,
                tokenExpiresAt: null,
                ghHostsPath: null,
                gitCredentialsPath: null,
                gitConfigPath: null,
            },
        },
    }
    const nextConfigVersion = runtimeState.row.configVersion + 1
    const nextTokenVersion = runtimeState.row.tokenVersion + 1
    const artifactNonce = crypto.randomUUID()
    const paths = hostedRoomPaths()
    const piConfig = buildPiRuntimeConfig({
        roomId: input.roomId,
        displayName: room.displayName,
        port: hostedRuntimePort,
        token,
        paths,
        sandbox: hostedSandbox,
        sandboxHardening: hostedSandboxHardening(),
        roomConfiguration,
        bindHost: '0.0.0.0',
    })
    const persistedStateFiles = await listHostedRuntimeStateFileMaterializations({
        env: input.env,
        workspaceId: input.actor.workspaceId,
        roomId: input.roomId,
    })
    const bundle = runtimeFileBundle([
        {
            path: hostedRuntimeConfigPath,
            content: `${JSON.stringify(piConfig, null, 4)}\n`,
            mode: 0o600,
        },
        {
            path: paths.runtimeTokenPath,
            content: `${token}\n`,
            mode: 0o600,
        },
        ...(providerMaterialization.authJson
            ? [
                  {
                      path: hostedProviderAuthPath,
                      content: `${providerMaterialization.authJson}\n`,
                      mode: 0o600,
                  },
              ]
            : []),
        ...persistedStateFiles,
    ])
    const runtimeEnv = buildHostedRuntimeEnv({
        roomConfiguration,
        token,
        bundle,
        redactionSecrets: hostedRuntimeRedactionSecrets({
            providerAuthJson: providerMaterialization.authJson,
            env,
            mcpServers: roomConfiguration.entitlements.mcpServers,
        }),
        providerCandidate: providerMaterialization.candidate,
        workspaceId: input.actor.workspaceId,
        roomId: input.roomId,
        publicOrigin,
    })
    const egressAllowedHosts = await hostedRuntimeAllowedHosts({
        runtimeConfig: piConfig,
        usageCallbackUrl: runtimeEnv[hostedRuntimeUsageCallbackUrlEnvKey],
        quotaCallbackUrl: runtimeEnv[hostedRuntimeQuotaCallbackUrlEnvKey],
    })
    const configObjectKey = hostedRuntimeConfigKey({
        workspaceId: input.actor.workspaceId,
        roomId: input.roomId,
        version: nextConfigVersion,
        nonce: artifactNonce,
    })
    const tokenObjectKey = hostedRuntimeTokenKey({
        workspaceId: input.actor.workspaceId,
        roomId: input.roomId,
        version: nextTokenVersion,
        nonce: artifactNonce,
    })
    const bundleObjectKey = hostedRuntimeBundleKey({
        workspaceId: input.actor.workspaceId,
        roomId: input.roomId,
        version: nextConfigVersion,
        nonce: artifactNonce,
    })
    const createdObjectKeys = [configObjectKey, tokenObjectKey, bundleObjectKey]
    try {
        await Promise.all([
            putHostedRuntimeArtifact({
                env: input.env,
                key: configObjectKey,
                plainText: JSON.stringify(piConfig, null, 4),
                contentType: 'application/json',
            }),
            putHostedRuntimeArtifact({
                env: input.env,
                key: bundleObjectKey,
                plainText: JSON.stringify(bundle),
                contentType: 'application/json',
            }),
            putHostedRuntimeArtifact({
                env: input.env,
                key: tokenObjectKey,
                plainText: token,
                contentType: 'text/plain',
            }),
        ])
    } catch (error) {
        await deleteSupersededRuntimeArtifacts({ env: input.env, keys: createdObjectKeys })
        throw error
    }
    const updateResult = await input.env.AGENT_ROOM_DB.prepare(
        `
            UPDATE hosted_room_runtime_state
            SET config_object_key = ?1,
                token_object_key = ?2,
                runtime_bundle_object_key = ?3,
                provider_candidate = ?4,
                config_version = ?5,
                token_version = ?6,
                health_status = 'unknown',
                last_health_at = NULL,
                last_error = NULL,
                updated_at = ?7
            WHERE workspace_id = ?8
              AND room_id = ?9
              AND config_version = ?10
              AND token_version = ?11
              AND EXISTS (
                  SELECT 1
                  FROM hosted_room
                  WHERE hosted_room.workspace_id = hosted_room_runtime_state.workspace_id
                    AND hosted_room.id = hosted_room_runtime_state.room_id
                    AND hosted_room.desired_state = 'running'
              )
        `,
    )
        .bind(
            configObjectKey,
            tokenObjectKey,
            bundleObjectKey,
            providerMaterialization.candidate,
            nextConfigVersion,
            nextTokenVersion,
            nowIso(),
            input.actor.workspaceId,
            input.roomId,
            runtimeState.row.configVersion,
            runtimeState.row.tokenVersion,
        )
        .run()
    if ((updateResult.meta.changes ?? 0) < 1) {
        await deleteSupersededRuntimeArtifacts({ env: input.env, keys: createdObjectKeys })
        throw new HostedRuntimeMaterializationConflictError()
    }
    const currentObjectKeys = new Set([configObjectKey, tokenObjectKey, bundleObjectKey])
    const staleObjectKeys = [
        runtimeState.row.configObjectKey,
        runtimeState.row.runtimeBundleObjectKey,
        previousTokenObjectKey,
    ].filter((key): key is string => key !== null && !currentObjectKeys.has(key))
    await deleteSupersededRuntimeArtifacts({ env: input.env, keys: staleObjectKeys })
    return {
        configObjectKey,
        tokenObjectKey,
        bundleObjectKey,
        runtimeConfig: piConfig,
        runtimeEnv,
        providerCandidate: providerMaterialization.candidate,
        egressAllowedHosts,
    }
}
