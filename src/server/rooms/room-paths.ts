import { lstatSync, mkdirSync, renameSync } from 'node:fs'
import { chmod, mkdir, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { getAppEnv } from '../config/env'
import type { RoomPaths } from '../domain/types'
import { assertSafeRoomPathId, roomFilesystemId } from './room-filesystem-id'
import { getRuntimeEngineProfile } from './runtime-engine-profile'

export { assertSafeRoomPathId, roomFilesystemId } from './room-filesystem-id'

function legacyRoomRootDir(roomId: string): string {
    const env = getAppEnv()
    assertSafeRoomPathId(roomId)
    return join(env.dataDir, 'rooms', roomId)
}

export function getRoomPaths(roomId: string): RoomPaths {
    assertSafeRoomPathId(roomId)
    const env = getAppEnv()
    const runtimeEngineProfile = getRuntimeEngineProfile()
    const roomRootDir = join(env.dataDir, 'rooms', roomFilesystemId(roomId))
    const runtimeDir = join(roomRootDir, 'runtime')
    const runtimeLogsDir = join(runtimeDir, 'logs')
    const runtimeSecretsDir = join(runtimeDir, 'secrets')
    const engineStateDir = join(roomRootDir, runtimeEngineProfile.stateDirName)
    const workspaceDir = join(roomRootDir, 'workspace')
    const storeDir = join(roomRootDir, 'store')
    const storeBlobsDir = join(storeDir, 'blobs')
    const storeManifestsDir = join(storeDir, 'manifests')
    const storeExportsDir = join(storeDir, 'exports')

    const paths = {
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
    migrateLegacyRoomFilesystemLayout(roomId, paths)
    return paths
}

function pathExists(path: string): boolean {
    try {
        lstatSync(path)
        return true
    } catch (error) {
        if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
            return false
        }
        throw error
    }
}

function migrateLegacyRoomFilesystemLayout(roomId: string, paths: RoomPaths): void {
    const legacyRoot = legacyRoomRootDir(roomId)
    if (legacyRoot === paths.roomRootDir || !pathExists(legacyRoot)) {
        return
    }
    if (pathExists(paths.roomRootDir)) {
        console.warn(
            'Legacy room filesystem layout exists beside opaque layout; using opaque layout',
        )
        return
    }
    mkdirSync(dirname(paths.roomRootDir), { recursive: true })
    renameSync(legacyRoot, paths.roomRootDir)
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
    await Promise.all([
        chmod(paths.roomRootDir, 0o700),
        chmod(paths.runtimeDir, 0o700),
        chmod(paths.runtimeLogsDir, 0o700),
        chmod(paths.runtimeSecretsDir, 0o700),
        chmod(paths.engineStateDir, 0o700),
        chmod(paths.workspaceDir, 0o700),
        chmod(paths.storeDir, 0o700),
        chmod(paths.storeBlobsDir, 0o700),
        chmod(paths.storeManifestsDir, 0o700),
        chmod(paths.storeExportsDir, 0o700),
    ])
    return paths
}

export async function writeRuntimeToken(tokenPath: string, token: string) {
    await writeFile(tokenPath, token, { encoding: 'utf8', mode: 0o600 })
    await chmod(tokenPath, 0o600)
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
