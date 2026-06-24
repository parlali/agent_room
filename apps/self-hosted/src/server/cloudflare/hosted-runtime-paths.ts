import type { RoomPaths } from '#/domain/domain-types'

export const hostedRuntimePort = 3000
export const hostedRuntimeConfigPath = '/workspace/runtime/pi-runtime.config.json'
export const hostedProviderAuthPath = '/workspace/runtime/secrets/provider-auth.json'

export function hostedRoomPaths(): RoomPaths {
    return {
        roomRootDir: '/workspace',
        runtimeDir: '/workspace/runtime',
        runtimeLogsDir: '/workspace/runtime/logs',
        runtimeSecretsDir: '/workspace/runtime/secrets',
        engineStateDir: '/workspace/runtime/pi-state',
        workspaceDir: '/workspace/workspace',
        storeDir: '/workspace/store',
        storeBlobsDir: '/workspace/store/blobs',
        storeManifestsDir: '/workspace/store/manifests',
        storeExportsDir: '/workspace/store/exports',
        runtimeConfigPath: hostedRuntimeConfigPath,
        runtimeEnvPath: '/workspace/runtime/pi-runtime.env',
        runtimeLogPath: '/workspace/runtime/logs/pi-runtime.log',
        runtimeMetadataPath: '/workspace/runtime/runtime.json',
        runtimeHealthPath: '/workspace/runtime/health.json',
        runtimeTokenPath: '/workspace/runtime/token',
    }
}
