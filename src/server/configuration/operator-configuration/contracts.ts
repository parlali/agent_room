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
    RoomProviderMode,
    RoomToolProfile,
} from '../../domain/types'
import {
    mcpAuthModes,
    mcpTransports,
    providerApis,
    providerAuthModes,
    roomProviderModes,
    roomSecretPurposes,
    roomToolProfiles,
} from '../../domain/types'
import type { providerCatalog } from '../provider-config'
import type { CodexAuthStatus } from '../codex-auth'

export const providerSaveSchema = z.object({
    id: z.string().uuid().optional(),
    label: z.string().trim().min(1),
    provider: z.string().trim().min(1),
    api: z.enum(providerApis),
    authMode: z.enum(providerAuthModes).optional(),
    baseUrl: z.string().trim().nullable().optional(),
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

export const roomConfigSaveSchema = z.object({
    roomId: z.string().uuid(),
    instructions: z.string().default(''),
    providerMode: z.enum(roomProviderModes),
    providerConnectionId: z.string().uuid().nullable().optional(),
    provider: z.string().trim().nullable().optional(),
    providerApi: z.enum(providerApis).nullable().optional(),
    providerBaseUrl: z.string().trim().nullable().optional(),
    providerModel: z.string().trim().nullable().optional(),
    providerApiKey: z.string().optional(),
    toolsProfile: z.enum(roomToolProfiles).default('coding'),
    capabilityOverrides: z.record(z.string(), z.boolean()).default({}),
    imageProvider: z.enum(['openai', 'gemini']).nullable().optional(),
    imageModel: z.string().trim().nullable().optional(),
    imageApiKey: z.string().optional(),
    cronTimezone: z.string().trim().min(1).default('UTC'),
    mcpConnectionIds: z.array(z.string().uuid()).default([]),
})

export const roomSecretSaveSchema = z.object({
    roomId: z.string().uuid(),
    label: z.string().trim().min(1),
    envKey: z.string().trim().min(1),
    purpose: z.enum(roomSecretPurposes),
    provider: z.string().trim().nullable().optional(),
    value: z.string().min(1),
})

export type ProviderSaveInput = z.input<typeof providerSaveSchema>
export type McpSaveInput = z.input<typeof mcpSaveSchema>
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
    }
    image: {
        provider: ImageProviderId | null
        model: string | null
        hasCredential: boolean
    }
    onboardingCompletedAt: string | null
}

export interface OperatorConfigSnapshot {
    settings: AppSettingsSummary
    providerCatalog: typeof providerCatalog
    providers: ProviderConnectionSummary[]
    mcpConnections: McpConnectionSummary[]
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
        provider: string | null
        providerApi: ProviderApi | null
        providerBaseUrl: string | null
        providerModel: string | null
        hasRoomProviderSecret: boolean
        toolsProfile: RoomToolProfile
        capabilities: CapabilityConfig
        capabilityOverrides: Record<string, boolean>
        imageProvider: ImageProviderId | null
        imageModel: string | null
        hasImageProviderSecret: boolean
        cronTimezone: string
        mcpConnectionIds: string[]
    }
    effective: {
        ready: boolean
        blockedReasons: string[]
        providerSource: 'app_default' | 'app_connection' | 'room_secret' | 'missing'
        providerLabel: string | null
        provider: string | null
        model: string | null
        mcpServers: string[]
        capabilities: CapabilityConfig
        searchReady: boolean
        imageReady: boolean
        codexAuth: CodexAuthStatus | null
    }
    providers: ProviderConnectionSummary[]
    mcpConnections: McpConnectionSummary[]
    roomSecrets: RoomSecretSummary[]
}
