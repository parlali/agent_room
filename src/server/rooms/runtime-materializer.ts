import { readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { randomBytes } from 'node:crypto'
import { join } from 'node:path'
import type { RoomRecord, RoomRuntimeMetadataRecord, RuntimeFileMetadata } from '../domain/types'
import { materializeRoomConfiguration } from '../configuration/operator-configuration'
import { ensureRoomFilesystemLayout, writeRuntimeToken } from './room-paths'
import { getRuntimeEngineProfile } from './runtime-engine-profile'

function renderEnvFile(input: Record<string, string>): string {
    const lines: string[] = []
    for (const [key, value] of Object.entries(input).sort(([a], [b]) => a.localeCompare(b))) {
        const escaped = value
            .replaceAll('\\', '\\\\')
            .replaceAll('\n', '\\n')
            .replaceAll('"', '\\"')
        lines.push(`${key}="${escaped}"`)
    }
    return `${lines.join('\n')}\n`
}

async function ensureToken(path: string): Promise<string> {
    try {
        const existing = await readFile(path, 'utf8')
        const token = existing.trim()
        if (token.length < 24) {
            throw new Error(`Token at ${path} is too short`)
        }
        return token
    } catch {
        const token = randomBytes(32).toString('base64url')
        await writeRuntimeToken(path, token)
        return token
    }
}

async function removeStaleRuntimeSecrets(runtimeSecretsDir: string): Promise<void> {
    const entries = await readdir(runtimeSecretsDir, {
        withFileTypes: true,
    })
    await Promise.all(
        entries
            .filter((entry) => entry.isFile() && entry.name.endsWith('.secret'))
            .map((entry) =>
                rm(join(runtimeSecretsDir, entry.name), {
                    force: true,
                }),
            ),
    )
}

export async function writeRuntimeFileMetadata(
    path: string,
    runtimeMetadata: RuntimeFileMetadata,
): Promise<void> {
    await writeFile(path, JSON.stringify(runtimeMetadata, null, 4), {
        encoding: 'utf8',
        mode: 0o600,
    })
}

export async function materializeRuntime(input: {
    room: RoomRecord
    runtimeMetadata: RoomRuntimeMetadataRecord
}): Promise<{
    port: number
    token: string
    configVersion: number
    tokenVersion: number
    runtimeMetadata: RuntimeFileMetadata
    env: Record<string, string>
}> {
    const runtimeEngineProfile = getRuntimeEngineProfile()
    const paths = await ensureRoomFilesystemLayout(input.room.id)
    const token = await ensureToken(paths.runtimeTokenPath)
    await removeStaleRuntimeSecrets(paths.runtimeSecretsDir)
    const roomConfiguration = await materializeRoomConfiguration({
        roomId: input.room.id,
        runtimeSecretsDir: paths.runtimeSecretsDir,
    })

    const port = input.runtimeMetadata.port
    if (port === null) {
        throw new Error(`Room ${input.room.id} has no allocated port`)
    }

    const runtimeProfile = runtimeEngineProfile.buildRuntimeProfile({
        roomId: input.room.id,
        displayName: input.room.displayName,
        port,
        token,
        paths,
        roomConfiguration,
    })

    const runtimeMetadata: RuntimeFileMetadata = {
        roomId: input.room.id,
        port,
        pid: null,
        startedAt: input.runtimeMetadata.startedAt?.toISOString() ?? new Date().toISOString(),
        configVersion: input.runtimeMetadata.configVersion,
        tokenVersion: input.runtimeMetadata.tokenVersion,
    }

    await writeFile(paths.runtimeConfigPath, JSON.stringify(runtimeProfile.config, null, 4), {
        encoding: 'utf8',
        mode: 0o600,
    })
    await writeFile(paths.runtimeEnvPath, renderEnvFile(runtimeProfile.env), {
        encoding: 'utf8',
        mode: 0o600,
    })
    await writeRuntimeFileMetadata(paths.runtimeMetadataPath, runtimeMetadata)
    return {
        port,
        token,
        configVersion: input.runtimeMetadata.configVersion,
        tokenVersion: input.runtimeMetadata.tokenVersion,
        runtimeMetadata,
        env: runtimeProfile.env,
    }
}
