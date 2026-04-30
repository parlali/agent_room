import { join } from 'node:path'
import { mkdtemp, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import type { MaterializedRoomConfiguration, RoomPaths } from '../domain/types'
import { buildPiRuntimeConfig } from './pi-runtime-config'
import { piRuntimeEngineProfile } from './pi-runtime-engine-profile'

function roomPaths(root: string): RoomPaths {
    return {
        roomRootDir: root,
        runtimeDir: join(root, 'runtime'),
        runtimeLogsDir: join(root, 'runtime', 'logs'),
        runtimeSecretsDir: join(root, 'runtime', 'secrets'),
        engineStateDir: join(root, 'pi-state'),
        workspaceDir: join(root, 'workspace'),
        storeDir: join(root, 'store'),
        storeBlobsDir: join(root, 'store', 'blobs'),
        storeManifestsDir: join(root, 'store', 'manifests'),
        storeExportsDir: join(root, 'store', 'exports'),
        runtimeConfigPath: join(root, 'runtime', 'pi-runtime.config.json'),
        runtimeEnvPath: join(root, 'runtime', 'pi-runtime.env'),
        runtimeLogPath: join(root, 'runtime', 'logs', 'pi-runtime.log'),
        runtimeMetadataPath: join(root, 'runtime', 'runtime.json'),
        runtimeHealthPath: join(root, 'runtime', 'health.json'),
        runtimeTokenPath: join(root, 'runtime', 'token'),
    }
}

function roomConfiguration(): MaterializedRoomConfiguration {
    return {
        instructions: 'Room policy',
        toolsProfile: 'coding',
        provider: {
            provider: 'lmstudio',
            authMode: 'api_key',
            api: 'openai-completions',
            model: 'lmstudio/local-model',
            fallbackModels: [],
            baseUrl: null,
            envKey: null,
        },
        entitlements: {
            env: {},
            secretRefs: [],
            mcpServers: [],
        },
    }
}

describe('Pi runtime config materialization', () => {
    it('keeps paths, auth, temp, and local model config under the room root', () => {
        const root = '/tmp/agent-room-test/room-1'
        const config = buildPiRuntimeConfig({
            roomId: 'room-1',
            displayName: 'Room One',
            port: 31234,
            token: 'token-token-token-token-token',
            paths: roomPaths(root),
            roomConfiguration: roomConfiguration(),
        })

        expect(config.runtime).toMatchObject({
            kind: 'pi',
            roomId: 'room-1',
            bindHost: '127.0.0.1',
            port: 31234,
        })
        expect(config.paths.stateDir).toBe(join(root, 'pi-state'))
        expect(config.paths.authPath).toBe(join(root, 'pi-state', 'auth.json'))
        expect(config.paths.internalStateDir).toBe(join(root, 'pi-state', 'internal-state'))
        expect(config.paths.homeDir).toBe(join(root, 'pi-state', 'home'))
        expect(config.paths.tmpDir).toBe(join(root, 'pi-state', 'tmp'))
        expect(config.compaction).toEqual({
            enabled: true,
            reserveTokens: 16384,
            keepRecentTokens: 20000,
        })
        expect(config.provider).toMatchObject({
            sourceProvider: 'lmstudio',
            piProvider: 'lmstudio',
            piModel: 'local-model',
            baseUrl: 'http://host.docker.internal:1234/v1',
            kind: 'local',
        })
        expect(config.models.providers.lmstudio).toMatchObject({
            baseUrl: 'http://host.docker.internal:1234/v1',
            apiKey: 'agent-room-local',
            compat: {
                supportsDeveloperRole: false,
                supportsReasoningEffort: false,
            },
        })
        expect(Object.keys(config.paths)).not.toContain('cronJobsPath')
    })

    it('materializes runtime env tokens and process directories under the room root', async () => {
        const root = await mkdtemp(join(tmpdir(), 'agent-room-pi-profile-'))
        try {
            const paths = roomPaths(root)
            const profile = piRuntimeEngineProfile.buildRuntimeProfile({
                roomId: 'room-1',
                displayName: 'Room One',
                port: 31234,
                token: 'token-token-token-token-token',
                paths,
                roomConfiguration: roomConfiguration(),
            })

            expect(profile.env).toMatchObject({
                AGENT_ROOM_PI_RUNTIME_CONFIG_PATH: paths.runtimeConfigPath,
                AGENT_ROOM_PI_RUNTIME_TOKEN: 'token-token-token-token-token',
                AGENT_ROOM_PI_STATE_DIR: paths.engineStateDir,
                AGENT_ROOM_WORKSPACE_DIR: paths.workspaceDir,
                AGENT_ROOM_STORE_DIR: paths.storeDir,
                PI_CODING_AGENT_DIR: paths.engineStateDir,
                HOME: join(root, 'pi-state', 'home'),
                TMPDIR: join(root, 'pi-state', 'tmp'),
            })
            expect((profile.config as { runtime: { token: string } }).runtime.token).toBe(
                'token-token-token-token-token',
            )
            expect((await stat(join(root, 'pi-state', 'home'))).isDirectory()).toBe(true)
            expect((await stat(join(root, 'pi-state', 'tmp'))).isDirectory()).toBe(true)
        } finally {
            await rm(root, {
                recursive: true,
                force: true,
            })
        }
    })

    it('fails closed when materialized room env tries to override runtime control keys', async () => {
        const root = await mkdtemp(join(tmpdir(), 'agent-room-pi-profile-'))
        try {
            const config = roomConfiguration()
            config.entitlements.env = {
                HOME: '/tmp/escape',
            }

            expect(() =>
                piRuntimeEngineProfile.buildRuntimeProfile({
                    roomId: 'room-1',
                    displayName: 'Room One',
                    port: 31234,
                    token: 'token-token-token-token-token',
                    paths: roomPaths(root),
                    roomConfiguration: config,
                }),
            ).toThrow(/reserved keys: HOME/)
        } finally {
            await rm(root, {
                recursive: true,
                force: true,
            })
        }
    })
})
