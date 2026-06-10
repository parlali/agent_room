import { auditRepository, roomRepository, roomSecretRepository } from '../../db/repositories'
import { assertNoReservedRoomRuntimeEnvKeys } from '../../security/process-env'
import { upperSnake } from '../provider-config'
import type { RoomSecretSaveInput, RoomSecretSummary } from './contracts'
import { roomSecretSaveSchema } from './contracts'
import { nullableText } from './helpers'
import { upsertEncryptedSecret } from './secrets'

export async function saveRoomSecret(
    rawInput: RoomSecretSaveInput,
    actorUserId: string,
): Promise<RoomSecretSummary> {
    const input = roomSecretSaveSchema.parse(rawInput)
    const room = await roomRepository.findRoomById(input.roomId)
    if (!room) {
        throw new Error(`Room ${input.roomId} does not exist`)
    }

    const envKey = upperSnake(input.envKey)
    if (!envKey) {
        throw new Error('Room secret env key must contain at least one letter or number')
    }
    assertNoReservedRoomRuntimeEnvKeys(
        {
            [envKey]: 'reserved-check',
        },
        'Room secret env key',
    )

    const secret = await upsertEncryptedSecret({
        keyName: `room:${input.roomId}:secret:${envKey}`,
        plainText: input.value,
    })
    const saved = await roomSecretRepository.upsert({
        roomId: input.roomId,
        secretId: secret.id,
        label: input.label,
        envKey,
        purpose: input.purpose,
        provider: nullableText(input.provider),
        createdByUserId: actorUserId,
    })

    await auditRepository.appendEvent({
        actorUserId,
        roomId: input.roomId,
        action: 'room_secret.saved',
        payload: {
            roomSecretId: saved.id,
            envKey: saved.envKey,
            purpose: saved.purpose,
            provider: saved.provider,
        },
    })

    return {
        id: saved.id,
        label: saved.label,
        envKey: saved.envKey,
        purpose: saved.purpose,
        provider: saved.provider,
        updatedAt: saved.updatedAt.toISOString(),
    }
}
