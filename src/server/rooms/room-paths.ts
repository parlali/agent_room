import { mkdir, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { getAppEnv } from '../config/env'
import type { RoomPaths } from '../domain/types'
import { getRuntimeEngineProfile } from './runtime-engine-profile'

export function getRoomPaths(roomId: string): RoomPaths {
    const env = getAppEnv()
    const runtimeEngineProfile = getRuntimeEngineProfile()
    const roomRootDir = join(env.dataDir, 'rooms', roomId)
    const runtimeDir = join(roomRootDir, 'runtime')
    const runtimeLogsDir = join(runtimeDir, 'logs')
    const runtimeSecretsDir = join(runtimeDir, 'secrets')
    const engineStateDir = join(roomRootDir, runtimeEngineProfile.stateDirName)
    const workspaceDir = join(roomRootDir, 'workspace')
    const storeDir = join(roomRootDir, 'store')
    const storeBlobsDir = join(storeDir, 'blobs')
    const storeManifestsDir = join(storeDir, 'manifests')
    const storeExportsDir = join(storeDir, 'exports')

    return {
        roomRootDir,
        runtimeDir,
        runtimeLogsDir,
        runtimeSecretsDir,
        engineStateDir,
        workspaceDir,
        storeDir,
        storeBlobsDir,
        storeManifestsDir,
        storeExportsDir,
        runtimeConfigPath: join(runtimeDir, runtimeEngineProfile.runtimeConfigFileName),
        runtimeEnvPath: join(runtimeDir, runtimeEngineProfile.runtimeEnvFileName),
        runtimeLogPath: join(runtimeLogsDir, runtimeEngineProfile.runtimeLogFileName),
        runtimeMetadataPath: join(runtimeDir, 'runtime.json'),
        runtimeHealthPath: join(runtimeDir, 'health.json'),
        runtimeTokenPath: join(runtimeDir, 'token'),
    }
}

export async function ensureRoomFilesystemLayout(roomId: string): Promise<RoomPaths> {
    const paths = getRoomPaths(roomId)
    await mkdir(paths.runtimeLogsDir, { recursive: true })
    await mkdir(paths.runtimeSecretsDir, { recursive: true })
    await mkdir(paths.engineStateDir, { recursive: true })
    await mkdir(paths.workspaceDir, { recursive: true })
    await mkdir(paths.storeBlobsDir, { recursive: true })
    await mkdir(paths.storeManifestsDir, { recursive: true })
    await mkdir(paths.storeExportsDir, { recursive: true })
    return paths
}

export async function writeRuntimeToken(tokenPath: string, token: string) {
    await writeFile(tokenPath, token, { encoding: 'utf8', mode: 0o600 })
}

export async function archiveFailedRoomFilesystemLayout(roomId: string): Promise<string | null> {
    const env = getAppEnv()
    const paths = getRoomPaths(roomId)
    const archiveRootDir = join(env.dataDir, 'system', 'failed-room-startups')
    const archiveDirName = `${new Date().toISOString().replaceAll(':', '-')}_${roomId}`
    const archivePath = join(archiveRootDir, archiveDirName)

    try {
        await mkdir(archiveRootDir, { recursive: true })
        await rename(paths.roomRootDir, archivePath)
        return archivePath
    } catch (error) {
        if (
            typeof error === 'object' &&
            error !== null &&
            'code' in error &&
            String((error as { code: unknown }).code) === 'ENOENT'
        ) {
            return null
        }
        throw error
    }
}
