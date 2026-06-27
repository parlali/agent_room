import type { RoomConfigSnapshot } from '#/server/configuration/operator-configuration'
import type { RoomMode, RoomProviderMode, RoomSecretPurpose } from '#/domain/domain-types'
import { ROOM_MODE_OPTIONS } from '#/domain/room-modes'

export type ProviderMode = RoomProviderMode
export type SecretPurpose = RoomSecretPurpose

export const ROOM_MODES = ROOM_MODE_OPTIONS

export const COMMON_TIMEZONES = [
    'UTC',
    'America/Los_Angeles',
    'America/Denver',
    'America/Chicago',
    'America/New_York',
    'America/Sao_Paulo',
    'Europe/London',
    'Europe/Berlin',
    'Europe/Istanbul',
    'Asia/Dubai',
    'Asia/Kolkata',
    'Asia/Singapore',
    'Asia/Tokyo',
    'Australia/Sydney',
]

export interface ConfigDraft {
    instructions: string
    providerMode: ProviderMode
    providerConnectionId: string
    roomMode: RoomMode
    capabilityOverrides: Record<string, boolean>
    imageProvider: 'inherit' | 'openai' | 'gemini'
    imageModel: string
    imageApiKey: string
    cronTimezone: string
    browserActionBudget: number
    mcpConnectionIds: string[]
    githubEnabled: boolean
    githubInstallationId: string
    githubRepositories: string[]
}

export interface SecretDraft {
    label: string
    envKey: string
    purpose: SecretPurpose
    provider: string
    value: string
}

export function emptySecretDraft(): SecretDraft {
    return {
        label: '',
        envKey: '',
        purpose: 'generic',
        provider: '',
        value: '',
    }
}

export function configFromSnapshot(snapshot: RoomConfigSnapshot): ConfigDraft {
    return {
        instructions: snapshot.config.instructions ?? '',
        providerMode: snapshot.config.providerMode,
        providerConnectionId: snapshot.config.providerConnectionId ?? '',
        roomMode: snapshot.config.roomMode || 'coworker',
        capabilityOverrides: { ...snapshot.config.capabilityOverrides },
        imageProvider: snapshot.config.imageProvider ?? 'inherit',
        imageModel: snapshot.config.imageModel ?? '',
        imageApiKey: '',
        cronTimezone: snapshot.config.cronTimezone || 'UTC',
        browserActionBudget: snapshot.config.browserActionBudget || 50,
        mcpConnectionIds: [...snapshot.config.mcpConnectionIds],
        githubEnabled: snapshot.config.github.enabled,
        githubInstallationId: snapshot.config.github.installationId ?? '',
        githubRepositories: [...snapshot.config.github.repositories],
    }
}

function arraysEqual(a: string[], b: string[]): boolean {
    if (a.length !== b.length) return false
    const sortedA = [...a].sort()
    const sortedB = [...b].sort()
    return sortedA.every((v, i) => v === sortedB[i])
}

function recordsEqual(a: Record<string, boolean>, b: Record<string, boolean>): boolean {
    const keys = Array.from(new Set([...Object.keys(a), ...Object.keys(b)]))
    return keys.every((key) => a[key] === b[key])
}

export function configsEqual(a: ConfigDraft, b: ConfigDraft): boolean {
    return (
        a.instructions === b.instructions &&
        a.providerMode === b.providerMode &&
        a.providerConnectionId === b.providerConnectionId &&
        a.roomMode === b.roomMode &&
        recordsEqual(a.capabilityOverrides, b.capabilityOverrides) &&
        a.imageProvider === b.imageProvider &&
        a.imageModel === b.imageModel &&
        a.imageApiKey === b.imageApiKey &&
        a.cronTimezone === b.cronTimezone &&
        a.browserActionBudget === b.browserActionBudget &&
        arraysEqual(a.mcpConnectionIds, b.mcpConnectionIds) &&
        a.githubEnabled === b.githubEnabled &&
        a.githubInstallationId === b.githubInstallationId &&
        arraysEqual(a.githubRepositories, b.githubRepositories)
    )
}
