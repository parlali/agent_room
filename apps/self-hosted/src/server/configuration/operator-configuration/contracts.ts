import { z } from 'zod'
import type {
    CapabilityConfig,
    CapabilityId,
    ConnectionStatus,
    ImageProviderId,
    McpAuthMode,
    McpTransport,
    ProviderAuthMode,
    ProviderApi,
    RoomMode,
    RoomProviderMode,
    SearchSafeSearch,
} from '#/domain/domain-types'
import {
    capabilityIds,
    imageProviderIds,
    mcpAuthModes,
    mcpTransports,
    roomModes,
    roomProviderModes,
    searchSafeSearchValues,
    userRoomSecretPurposes,
} from '#/domain/domain-types'
import type { providerCatalog } from '../provider-config'
import type { CodexAppAuthStatus } from '../codex-auth'

export const providerSaveSchema = z.object({
    id: z.string().uuid().optional(),
    label: z.string().trim().min(1),
    provider: z.string().trim().min(1),
    defaultModel: z.string().trim().min(1),
    fallbackModels: z.array(z.string().trim().min(1)).default([]),
    apiKey: z.string().optional(),
    makeDefault: z.boolean().optional(),
})

export const mcpSaveSchema = z.object({
    id: z.string().uuid().optional(),
    name: z.string().trim().min(1),
    serverKey: z.string().trim().min(1),
    transport: z.enum(mcpTransports),
    command: z.string().trim().nullable().optional(),
    argsText: z.string().optional(),
    url: z.string().trim().nullable().optional(),
    headersText: z.string().optional(),
    authMode: z.enum(mcpAuthModes).default('none'),
    bearerToken: z.string().optional(),
    allowedToolsText: z.string().optional(),
})

export const appDefaultsSaveSchema = z.object({
    defaultProviderConnectionId: z.string().uuid().nullable(),
    defaultModel: z.string().nullable(),
    onboardingCompleted: z.boolean(),
})

export const appCapabilitySettingsSaveSchema = z.object({
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
        provider: z.enum(imageProviderIds).nullable(),
        model: z.string().nullable(),
        apiKey: z.string().optional(),
    }),
})

export const roomConfigSaveSchema = z.object({
    roomId: z.string().uuid(),
    instructions: z.string().default(''),
    providerMode: z.enum(roomProviderModes),
    providerConnectionId: z.string().uuid().nullable().optional(),
    roomMode: z.enum(roomModes).default('coworker'),
    capabilityOverrides: z.record(z.string(), z.boolean()).default({}),
    imageProvider: z.enum(['openai', 'gemini']).nullable().optional(),
    imageModel: z.string().trim().nullable().optional(),
    imageApiKey: z.string().optional(),
    cronTimezone: z.string().trim().min(1).default('UTC'),
    browserActionBudget: z.number().int().min(1).max(200).default(50),
    mcpConnectionIds: z.array(z.string().uuid()).default([]),
    githubEnabled: z.boolean().default(false),
    githubInstallationId: z.string().nullable().optional(),
    githubRepositories: z.array(z.string().trim().min(1)).default([]),
})

export const roomSecretSaveSchema = z.object({
    roomId: z.string().uuid(),
    label: z.string().trim().min(1),
    envKey: z.string().trim().min(1),
    purpose: z.enum(userRoomSecretPurposes),
    provider: z.string().trim().nullable().optional(),
    value: z.string().min(1),
})

export type ProviderSaveInput = z.input<typeof providerSaveSchema>
export type McpSaveInput = z.input<typeof mcpSaveSchema>
export type AppDefaultsSaveInput = z.input<typeof appDefaultsSaveSchema>
export type AppCapabilitySettingsSaveInput = z.input<typeof appCapabilitySettingsSaveSchema>
export type RoomConfigSaveInput = z.input<typeof roomConfigSaveSchema>
export type RoomSecretSaveInput = z.input<typeof roomSecretSaveSchema>

export interface ProviderConnectionSummary {
    id: string
    label: string
    provider: string
    authMode: ProviderAuthMode
    api: ProviderApi
    baseUrl: string | null
    defaultModel: string
    fallbackModels: string[]
    hasCredential: boolean
    status: ConnectionStatus
    validationMessage: string | null
    lastValidatedAt: string | null
    updatedAt: string
}

export interface McpConnectionSummary {
    id: string
    name: string
    serverKey: string
    transport: McpTransport
    command: string | null
    args: string[]
    url: string | null
    headers: Record<string, string>
    authMode: McpAuthMode
    hasCredential: boolean
    allowedTools: string[]
    status: ConnectionStatus
    validationMessage: string | null
    lastValidatedAt: string | null
    updatedAt: string
}

export interface AppSettingsSummary {
    defaultProviderConnectionId: string | null
    defaultModel: string | null
    capabilityDefaults: Record<CapabilityId, boolean>
    search: {
        enabled: boolean
        backendUrl: string
        defaultResultCount: number
        timeoutMs: number
        maxSearchesPerRun: number
        brave: {
            enabled: boolean
            hasCredential: boolean
            country: string | null
            searchLang: string | null
            safeSearch: SearchSafeSearch
            timeoutMs: number
            resultCount: number
        }
        browserbase: {
            enabled: boolean
            hasCredential: boolean
            timeoutMs: number
            resultCount: number
        }
    }
    image: {
        provider: ImageProviderId | null
        model: string | null
        hasCredential: boolean
    }
    onboardingCompletedAt: string | null
}

export interface GitHubAppSummary {
    configured: boolean
    appId: string | null
    slug: string | null
    name: string | null
    clientId: string | null
    htmlUrl: string | null
    status: ConnectionStatus | null
    validationMessage: string | null
    lastValidatedAt: string | null
    updatedAt: string | null
    installUrl: string | null
}

export interface GitHubInstallationSummary {
    installationId: string
    accountLogin: string
    accountType: string
    targetType: string | null
    htmlUrl: string | null
    repositorySelection: string
    permissions: Record<string, string>
    suspendedAt: string | null
    status: ConnectionStatus
    lastSyncedAt: string
    updatedAt: string
}

export interface GitHubUserConnectionSummary {
    connected: boolean
    login: string | null
    name: string | null
    avatarUrl: string | null
    htmlUrl: string | null
    status: ConnectionStatus | null
    validationMessage: string | null
    lastAuthorizedAt: string | null
    updatedAt: string | null
}

export interface GitHubAccountSummary {
    login: string
    accountType: string
    avatarUrl: string | null
    htmlUrl: string | null
    installed: boolean
    installationId: string | null
    installationStatus: ConnectionStatus | null
    repositorySelection: string | null
    installUrl: string | null
    manageUrl: string | null
    updatedAt: string | null
}

export interface GitHubIntegrationSummary {
    app: GitHubAppSummary
    user: GitHubUserConnectionSummary
    installations: GitHubInstallationSummary[]
    accounts: GitHubAccountSummary[]
}

export interface GitHubRoomBindingSummary {
    enabled: boolean
    installationId: string | null
    repositories: string[]
}

export interface GitHubRepositorySummary {
    id: string
    fullName: string
    private: boolean
    defaultBranch: string | null
}

export interface GitHubRepositorySearchResult {
    repositories: GitHubRepositorySummary[]
    totalCount: number
    scannedCount: number
    hasMore: boolean
    nextPage: number | null
    query: string
}

export interface OperatorConfigSnapshot {
    settings: AppSettingsSummary
    codexAuth: CodexAppAuthStatus
    providerCatalog: typeof providerCatalog
    providers: ProviderConnectionSummary[]
    mcpConnections: McpConnectionSummary[]
    github: GitHubIntegrationSummary
    onboarding: {
        completed: boolean
        hasProvider: boolean
        hasDefaultProvider: boolean
    }
}

export interface RoomSecretSummary {
    id: string
    label: string
    envKey: string
    purpose: string
    provider: string | null
    updatedAt: string
}

export interface RoomConfigSnapshot {
    roomId: string
    config: {
        instructions: string
        providerMode: RoomProviderMode
        providerConnectionId: string | null
        roomMode: RoomMode
        capabilities: CapabilityConfig
        capabilityOverrides: Record<string, boolean>
        imageProvider: ImageProviderId | null
        imageModel: string | null
        hasImageProviderSecret: boolean
        cronTimezone: string
        browserActionBudget: number
        mcpConnectionIds: string[]
        github: GitHubRoomBindingSummary
    }
    effective: {
        ready: boolean
        blockedReasons: string[]
        providerSource: 'app_default' | 'app_connection' | 'missing'
        providerLabel: string | null
        provider: string | null
        model: string | null
        mcpServers: string[]
        capabilities: CapabilityConfig
        searchReady: boolean
        imageReady: boolean
        codexAuth: CodexAppAuthStatus | null
        github: {
            ready: boolean
            enabled: boolean
            installationId: string | null
            accountLogin: string | null
            repositories: string[]
            message: string | null
        }
    }
    providers: ProviderConnectionSummary[]
    mcpConnections: McpConnectionSummary[]
    github: GitHubIntegrationSummary
    roomSecrets: RoomSecretSummary[]
}
