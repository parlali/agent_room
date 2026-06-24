import type { JsonValue } from '#/domain/domain-types'
import { normalizeSearchConfig, searchProviderSecretId } from '../configuration/capabilities'
import type {
    AppCapabilitySettingsSaveInput,
    AppDefaultsSaveInput,
    OperatorConfigSnapshot,
} from '../configuration/operator-configuration'
import {
    imageConfigRecord,
    imageConfigSecretId,
    nullableText,
} from '../configuration/operator-configuration/helpers'
import type { AgentRoomHostedEnv } from './bindings'
import { appendHostedAudit } from './hosted-audit'
import type { HostedActor } from './hosted-auth'
import { validateHostedSearchCredential } from './hosted-connection-validation'
import { toJsonValue } from './hosted-json'
import {
    findHostedProvider,
    getHostedOperatorConfigSnapshot,
    getHostedWorkspaceSettings,
    hostedSearchDefaults,
    normalizeHostedSearchBackendUrl,
} from './hosted-operator-config-service'
import { rematerializeRunningHostedRooms } from './hosted-room-service'
import {
    deleteHostedSecret,
    readHostedSecretPlainText,
    upsertHostedSecret,
} from './hosted-secret-store'
import { updateHostedWorkspaceSettings } from './hosted-workspace-settings-write'

type HostedSearchSecretProvider = 'brave' | 'browserbase'

interface HostedSearchSecretInput {
    env: AgentRoomHostedEnv
    workspaceId: string
    provider: HostedSearchSecretProvider
    enabled: boolean
    apiKey: string | undefined
    currentConfig: JsonValue
}

interface ResolvedHostedSearchCredential {
    secretId: string | null
    plainText: string | null
    writeNewSecret: boolean
}

async function resolveHostedSearchCredential(
    input: HostedSearchSecretInput,
): Promise<ResolvedHostedSearchCredential> {
    if (!input.enabled) {
        return {
            secretId: null,
            plainText: null,
            writeNewSecret: false,
        }
    }
    const apiKey = input.apiKey?.trim() ?? ''
    if (apiKey) {
        return {
            secretId: null,
            plainText: apiKey,
            writeNewSecret: true,
        }
    }
    const currentSecretId = searchProviderSecretId({
        config: input.currentConfig,
        provider: input.provider,
    })
    if (currentSecretId) {
        const existing = await readHostedSecretPlainText({
            env: input.env,
            workspaceId: input.workspaceId,
            secretId: currentSecretId,
        })
        if (!existing) {
            throw new Error(`${input.provider} search API key is missing; enter a new key`)
        }
        return {
            secretId: currentSecretId,
            plainText: existing,
            writeNewSecret: false,
        }
    }
    throw new Error(`${input.provider} search API key is required when enabling search`)
}

async function validateResolvedHostedSearchCredential(input: {
    provider: HostedSearchSecretProvider
    searchConfig: unknown
    credential: ResolvedHostedSearchCredential
}): Promise<void> {
    if (!input.credential.plainText) {
        return
    }
    const validation = await validateHostedSearchCredential({
        provider: input.provider,
        search: normalizeSearchConfig(input.searchConfig, hostedSearchDefaults),
        apiKey: input.credential.plainText,
    })
    if (validation.status !== 'ready') {
        throw new Error(validation.message)
    }
}

async function writeHostedSearchSecretId(input: {
    credential: ResolvedHostedSearchCredential
    env: AgentRoomHostedEnv
    workspaceId: string
    provider: HostedSearchSecretProvider
    enabled: boolean
}): Promise<string | null> {
    if (!input.enabled) {
        return null
    }
    if (input.credential.writeNewSecret && input.credential.plainText) {
        return upsertHostedSecret({
            env: input.env,
            workspaceId: input.workspaceId,
            keyName: `app_search:${input.provider}`,
            plainText: input.credential.plainText,
        })
    }
    return input.credential.secretId
}

async function resolveHostedImageSecretId(input: {
    env: AgentRoomHostedEnv
    workspaceId: string
    apiKey: string
    currentProvider: string | null
    currentSecretId: string | null
    provider: string
}): Promise<string> {
    if (input.apiKey) {
        return upsertHostedSecret({
            env: input.env,
            workspaceId: input.workspaceId,
            keyName: 'app_image',
            plainText: input.apiKey,
        })
    }
    if (input.currentProvider === input.provider && input.currentSecretId) {
        const existing = await readHostedSecretPlainText({
            env: input.env,
            workspaceId: input.workspaceId,
            secretId: input.currentSecretId,
        })
        if (!existing) {
            throw new Error('Saved image API key is missing; enter a new image API key')
        }
        return input.currentSecretId
    }
    throw new Error('Image API key is required when enabling an app image provider')
}

async function deleteStaleHostedAppCapabilitySecrets(input: {
    env: AgentRoomHostedEnv
    workspaceId: string
    currentSearchConfig: JsonValue
    currentImageSecretId: string | null
    retainedSecretIds: Set<string>
}): Promise<void> {
    const staleSecretIds = [
        searchProviderSecretId({
            config: input.currentSearchConfig,
            provider: 'brave',
        }),
        searchProviderSecretId({
            config: input.currentSearchConfig,
            provider: 'browserbase',
        }),
        input.currentImageSecretId,
    ].filter(
        (secretId): secretId is string =>
            typeof secretId === 'string' && !input.retainedSecretIds.has(secretId),
    )
    for (const secretId of [...new Set(staleSecretIds)]) {
        await deleteHostedSecret({
            env: input.env,
            workspaceId: input.workspaceId,
            secretId,
        })
    }
}

export async function updateHostedAppDefaults(input: {
    env: AgentRoomHostedEnv
    actor: HostedActor
    data: AppDefaultsSaveInput
}): Promise<OperatorConfigSnapshot> {
    if (input.data.defaultProviderConnectionId) {
        const provider = await findHostedProvider({
            env: input.env,
            workspaceId: input.actor.workspaceId,
            id: input.data.defaultProviderConnectionId,
        })
        if (!provider) {
            throw new Error('Provider connection not found')
        }
        if (provider.status !== 'ready') {
            throw new Error('Default provider connection must be ready')
        }
    }
    await updateHostedWorkspaceSettings(input.env, input.actor.workspaceId, {
        defaultProviderConnectionId: input.data.defaultProviderConnectionId,
        defaultModel: input.data.defaultModel,
        onboardingCompletedAt: input.data.onboardingCompleted ? new Date() : null,
    })
    await appendHostedAudit({
        env: input.env,
        workspaceId: input.actor.workspaceId,
        actorUserId: input.actor.userId,
        roomId: null,
        action: 'operator.defaults.saved',
        payload: {
            defaultProviderConnectionId: input.data.defaultProviderConnectionId,
            defaultModel: input.data.defaultModel,
            onboardingCompleted: input.data.onboardingCompleted,
        },
    })
    await rematerializeRunningHostedRooms({
        env: input.env,
        actor: input.actor,
    })
    return getHostedOperatorConfigSnapshot(input)
}

export async function updateHostedAppCapabilitySettings(input: {
    env: AgentRoomHostedEnv
    actor: HostedActor
    data: AppCapabilitySettingsSaveInput
}): Promise<OperatorConfigSnapshot> {
    const settings = await getHostedWorkspaceSettings({
        env: input.env,
        workspaceId: input.actor.workspaceId,
    })
    const nextSearch = input.data.search
        ? {
              ...input.data.search,
              backendUrl: normalizeHostedSearchBackendUrl(input.data.search.backendUrl),
          }
        : null
    const currentImageProvider = imageConfigRecord(settings.imageConfig).provider
    const currentImageSecretId = imageConfigSecretId(settings.imageConfig)
    const imageProvider = input.data.image.provider
    const imageModel = imageProvider ? nullableText(input.data.image.model) : null
    const imageApiKey = input.data.image.apiKey?.trim() ?? ''

    if (imageProvider && !imageModel) {
        throw new Error('Default image model is required when image generation is enabled')
    }

    const braveSearchSecretInput = nextSearch
        ? {
              env: input.env,
              workspaceId: input.actor.workspaceId,
              provider: 'brave' as const,
              enabled: nextSearch.brave.enabled,
              apiKey: nextSearch.brave.apiKey,
              currentConfig: settings.searchConfig,
          }
        : null
    const browserbaseSearchSecretInput = nextSearch
        ? {
              env: input.env,
              workspaceId: input.actor.workspaceId,
              provider: 'browserbase' as const,
              enabled: nextSearch.browserbase.enabled,
              apiKey: nextSearch.browserbase.apiKey,
              currentConfig: settings.searchConfig,
          }
        : null
    const [braveCredential, browserbaseCredential] =
        braveSearchSecretInput && browserbaseSearchSecretInput
            ? await Promise.all([
                  resolveHostedSearchCredential(braveSearchSecretInput),
                  resolveHostedSearchCredential(browserbaseSearchSecretInput),
              ])
            : [
                  {
                      secretId: searchProviderSecretId({
                          config: settings.searchConfig,
                          provider: 'brave',
                      }),
                      plainText: null,
                      writeNewSecret: false,
                  },
                  {
                      secretId: searchProviderSecretId({
                          config: settings.searchConfig,
                          provider: 'browserbase',
                      }),
                      plainText: null,
                      writeNewSecret: false,
                  },
              ]
    if (nextSearch) {
        await validateResolvedHostedSearchCredential({
            provider: 'brave',
            searchConfig: nextSearch,
            credential: braveCredential,
        })
        await validateResolvedHostedSearchCredential({
            provider: 'browserbase',
            searchConfig: nextSearch,
            credential: browserbaseCredential,
        })
    }
    const [braveSecretId, browserbaseSecretId] =
        braveSearchSecretInput && browserbaseSearchSecretInput
            ? await Promise.all([
                  writeHostedSearchSecretId({
                      ...braveSearchSecretInput,
                      credential: braveCredential,
                  }),
                  writeHostedSearchSecretId({
                      ...browserbaseSearchSecretInput,
                      credential: browserbaseCredential,
                  }),
              ])
            : [braveCredential.secretId, browserbaseCredential.secretId]
    const imageSecretId =
        imageProvider && imageModel
            ? await resolveHostedImageSecretId({
                  env: input.env,
                  workspaceId: input.actor.workspaceId,
                  apiKey: imageApiKey,
                  currentProvider:
                      typeof currentImageProvider === 'string' ? currentImageProvider : null,
                  currentSecretId: currentImageSecretId,
                  provider: imageProvider,
              })
            : null
    const searchConfig = nextSearch
        ? {
              enabled: nextSearch.enabled,
              backendUrl: nextSearch.backendUrl,
              defaultResultCount: nextSearch.defaultResultCount,
              timeoutMs: nextSearch.timeoutMs,
              maxSearchesPerRun: nextSearch.maxSearchesPerRun,
              brave: {
                  enabled: nextSearch.brave.enabled,
                  country: nextSearch.brave.country,
                  searchLang: nextSearch.brave.searchLang,
                  safeSearch: nextSearch.brave.safeSearch,
                  timeoutMs: nextSearch.brave.timeoutMs,
                  resultCount: nextSearch.brave.resultCount,
                  secretId: braveSecretId,
              },
              browserbase: {
                  enabled: nextSearch.browserbase.enabled,
                  timeoutMs: nextSearch.browserbase.timeoutMs,
                  resultCount: nextSearch.browserbase.resultCount,
                  secretId: browserbaseSecretId,
              },
          }
        : settings.searchConfig
    await updateHostedWorkspaceSettings(input.env, input.actor.workspaceId, {
        capabilityDefaults: toJsonValue(input.data.capabilityDefaults),
        searchConfig: toJsonValue(searchConfig),
        imageConfig: {
            provider: imageProvider,
            model: imageModel,
            secretId: imageSecretId,
        },
    })
    await deleteStaleHostedAppCapabilitySecrets({
        env: input.env,
        workspaceId: input.actor.workspaceId,
        currentSearchConfig: settings.searchConfig,
        currentImageSecretId,
        retainedSecretIds: new Set(
            [braveSecretId, browserbaseSecretId, imageSecretId].filter(
                (secretId): secretId is string => secretId !== null,
            ),
        ),
    })
    await appendHostedAudit({
        env: input.env,
        workspaceId: input.actor.workspaceId,
        actorUserId: input.actor.userId,
        roomId: null,
        action: 'operator.capabilities.saved',
        payload: {
            capabilityDefaults: toJsonValue(input.data.capabilityDefaults),
            search: nextSearch
                ? {
                      enabled: nextSearch.enabled,
                      backendUrl: nextSearch.backendUrl,
                      brave: {
                          enabled: nextSearch.brave.enabled,
                          credentialMode: braveSecretId ? 'stored' : 'none',
                      },
                      browserbase: {
                          enabled: nextSearch.browserbase.enabled,
                          credentialMode: browserbaseSecretId ? 'stored' : 'none',
                      },
                  }
                : null,
            image: {
                provider: imageProvider,
                model: imageModel,
                hasCredential: imageSecretId !== null,
            },
        },
    })
    await rematerializeRunningHostedRooms({
        env: input.env,
        actor: input.actor,
    })
    return getHostedOperatorConfigSnapshot(input)
}
