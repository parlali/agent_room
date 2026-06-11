import type { ImageProviderId, JsonValue, SecretRecord } from '#/domain/domain-types'
import {
    appProviderConnectionRepository,
    auditRepository,
    roomConfigRepository,
    roomMcpBindingRepository,
    roomRepository,
    roomSecretRepository,
    secretRepository,
} from '../../db/repositories'
import { normalizeImageProvider } from '../capabilities'
import { saveRoomGitHubBinding } from '../github-app'
import type { RoomConfigSaveInput, RoomConfigSnapshot } from './contracts'
import { roomConfigSaveSchema } from './contracts'
import { imageProviderEnvKey, nullableText } from './helpers'
import { reconcileRoomAutostart } from '../../rooms/room-autostart'
import { getRoomConfigSnapshot } from './room-config-snapshot'
import { upsertEncryptedSecret } from './secrets'

async function upsertRoomImageSecret(input: {
    roomId: string
    actorUserId: string
    provider: ImageProviderId
    apiKey: string
}): Promise<SecretRecord> {
    const envKey = imageProviderEnvKey(input.provider)
    const secret = await upsertEncryptedSecret({
        keyName: `room:${input.roomId}:image:${input.provider}:api_key`,
        plainText: input.apiKey,
    })

    await roomSecretRepository.upsert({
        roomId: input.roomId,
        secretId: secret.id,
        label: `${input.provider} image key`,
        envKey,
        purpose: 'image_api_key',
        provider: input.provider,
        createdByUserId: input.actorUserId,
    })

    return secret
}

async function reconcileRuntimeAfterRoomConfigSave(input: {
    roomId: string
    actorUserId: string
}): Promise<void> {
    try {
        await reconcileRoomAutostart({
            roomId: input.roomId,
            actorUserId: input.actorUserId,
            trigger: 'room_config_saved',
        })
    } catch (error) {
        console.error(
            `Room configuration saved but runtime autostart reconciliation failed for ${input.roomId}`,
            error instanceof Error ? error.message : error,
        )
    }
}

export async function saveRoomConfig(
    rawInput: RoomConfigSaveInput,
    actorUserId: string,
    options: {
        reconcileAutostart?: boolean
    } = {},
): Promise<RoomConfigSnapshot> {
    const input = roomConfigSaveSchema.parse(rawInput)
    const room = await roomRepository.findRoomById(input.roomId)
    if (!room) {
        throw new Error(`Room ${input.roomId} does not exist`)
    }

    const existing = await roomConfigRepository.getOrCreate(input.roomId)
    const previousImageSecretId = existing.imageSecretId
    let imageSecretId = existing.imageSecretId

    if (input.providerMode === 'app_connection') {
        if (!input.providerConnectionId) {
            throw new Error('Room provider connection is required')
        }
        const providerConnection = await appProviderConnectionRepository.findById(
            input.providerConnectionId,
        )
        if (!providerConnection) {
            throw new Error('Room provider connection does not exist')
        }
    }

    const imageProvider = normalizeImageProvider(input.imageProvider)
    const imageModel = nullableText(input.imageModel)
    const imageApiKey = input.imageApiKey?.trim() ?? ''
    if (imageProvider && imageModel) {
        if (imageApiKey) {
            const secret = await upsertRoomImageSecret({
                roomId: input.roomId,
                actorUserId,
                provider: imageProvider,
                apiKey: imageApiKey,
            })
            imageSecretId = secret.id
            await auditRepository.appendEvent({
                actorUserId,
                roomId: input.roomId,
                action: 'room_image_secret.rotated',
                payload: {
                    provider: imageProvider,
                },
            })
        } else if (!imageSecretId) {
            imageSecretId = null
        } else if (existing.imageProvider !== imageProvider) {
            imageSecretId = null
        }
    } else {
        imageSecretId = null
    }

    const config = await roomConfigRepository.upsert({
        roomId: input.roomId,
        instructions: input.instructions.trim(),
        providerMode: input.providerMode,
        providerConnectionId:
            input.providerMode === 'app_connection' ? (input.providerConnectionId ?? null) : null,
        roomMode: input.roomMode,
        capabilityOverrides: input.capabilityOverrides as JsonValue,
        imageProvider,
        imageModel: imageProvider ? imageModel : null,
        imageSecretId,
        cronTimezone: input.cronTimezone,
        browserActionBudget: input.browserActionBudget,
    })

    await roomMcpBindingRepository.replaceForRoom(
        input.roomId,
        input.mcpConnectionIds.map((mcpConnectionId) => ({
            mcpConnectionId,
            allowedTools: [],
            enabled: true,
        })),
    )
    await saveRoomGitHubBinding({
        roomId: input.roomId,
        enabled: input.githubEnabled,
        installationId: input.githubInstallationId,
        repositories: input.githubRepositories,
        actorUserId,
    })

    await auditRepository.appendEvent({
        actorUserId,
        roomId: input.roomId,
        action: 'room_config.updated',
        payload: {
            providerMode: config.providerMode,
            providerConnectionId: config.providerConnectionId,
            roomMode: config.roomMode,
            mcpConnectionCount: input.mcpConnectionIds.length,
            githubEnabled: input.githubEnabled,
            hasInstructions: config.instructions.length > 0,
            enabledCapabilities: Object.entries(
                config.capabilityOverrides &&
                    typeof config.capabilityOverrides === 'object' &&
                    !Array.isArray(config.capabilityOverrides)
                    ? config.capabilityOverrides
                    : {},
            )
                .filter(([, value]) => value === true)
                .map(([key]) => key),
            imageProvider: config.imageProvider,
            hasImageProviderSecret: config.imageSecretId !== null,
            browserActionBudget: config.browserActionBudget,
        },
    })

    const retainedSecretIds = new Set(
        [config.imageSecretId].filter(
            (secretId): secretId is string => typeof secretId === 'string',
        ),
    )
    const staleSecretIds = [previousImageSecretId].filter(
        (secretId): secretId is string =>
            typeof secretId === 'string' && !retainedSecretIds.has(secretId),
    )
    for (const secretId of [...new Set(staleSecretIds)]) {
        await secretRepository.deleteById(secretId)
    }
    if (staleSecretIds.length > 0) {
        await auditRepository.appendEvent({
            actorUserId,
            roomId: input.roomId,
            action: 'room_credential_secret.cleaned',
            payload: {
                count: new Set(staleSecretIds).size,
            },
        })
    }

    const snapshot = await getRoomConfigSnapshot(input.roomId)
    if (options.reconcileAutostart !== false) {
        await reconcileRuntimeAfterRoomConfigSave({
            roomId: input.roomId,
            actorUserId,
        })
    }
    return snapshot
}

export const __testing = {
    reconcileRuntimeAfterRoomConfigSave,
}
