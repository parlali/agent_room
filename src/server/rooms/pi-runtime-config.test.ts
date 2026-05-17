import { join } from 'node:path'
import { mkdtemp, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import type {
    MaterializedRoomConfiguration,
    RoomPaths,
    RuntimeSandboxIdentity,
} from '../domain/types'
import {
    testBudgets,
    testCapabilities,
    testImage,
    testSearch,
} from '../pi-runtime/test-runtime-defaults'
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
        roomMode: 'coworker',
        capabilities: testCapabilities,
        search: testSearch,
        image: testImage,
        budgets: testBudgets,
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
            internalEnv: {},
            secretRefs: [],
            mcpServers: [],
            github: {
                enabled: false,
                installationId: null,
                accountLogin: null,
                repositories: [],
                tokenEnvKey: null,
                tokenExpiresAt: null,
                ghHostsPath: null,
                gitCredentialsPath: null,
                gitConfigPath: null,
            },
        },
    }
}

function sandbox(): RuntimeSandboxIdentity {
    return {
        mode: 'per-room',
        uid: 12345,
        gid: 12345,
        userName: 'ar-test',
        groupName: 'ar-test',
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
            sandbox: sandbox(),
            roomConfiguration: roomConfiguration(),
        })

        expect(config.runtime).toMatchObject({
            kind: 'pi',
            roomId: 'room-1',
            bindHost: '127.0.0.1',
            port: 31234,
        })
        expect(config.sandbox).toEqual(sandbox())
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

    it('keeps built-in Pi model metadata and pricing for known providers', () => {
        const root = '/tmp/agent-room-test/room-1'
        const roomConfig = roomConfiguration()
        roomConfig.provider = {
            provider: 'openai-codex',
            authMode: 'oauth',
            api: 'openai-codex-responses',
            model: 'openai-codex/gpt-5.5',
            fallbackModels: [],
            baseUrl: null,
            envKey: null,
        }

        const config = buildPiRuntimeConfig({
            roomId: 'room-1',
            displayName: 'Room One',
            port: 31234,
            token: 'token-token-token-token-token',
            paths: roomPaths(root),
            sandbox: sandbox(),
            roomConfiguration: roomConfig,
        })

        expect(config.models.providers['openai-codex']).toMatchObject({
            api: 'openai-codex-responses',
            modelOverrides: {
                'gpt-5.5': {},
            },
        })
        expect(config.models.providers['openai-codex'].models).toBeUndefined()
    })

    it('keeps GitHub credential paths under the room-local home directory', () => {
        const root = '/tmp/agent-room-test/room-1'
        const roomConfig = roomConfiguration()
        roomConfig.entitlements.github = {
            enabled: true,
            installationId: '123',
            accountLogin: 'agent-room',
            repositories: ['agent-room/example'],
            tokenEnvKey: 'AGENT_ROOM_GITHUB_INSTALLATION_TOKEN',
            tokenExpiresAt: '2026-05-11T12:00:00.000Z',
            ghHostsPath: null,
            gitCredentialsPath: null,
            gitConfigPath: null,
        }

        const config = buildPiRuntimeConfig({
            roomId: 'room-1',
            displayName: 'Room One',
            port: 31234,
            token: 'token-token-token-token-token',
            paths: roomPaths(root),
            sandbox: sandbox(),
            roomConfiguration: roomConfig,
        })

        expect(config.github).toMatchObject({
            enabled: true,
            installationId: '123',
            repositories: ['agent-room/example'],
            ghHostsPath: join(root, 'pi-state', 'home', '.config', 'gh', 'hosts.yml'),
            gitCredentialsPath: join(root, 'pi-state', 'home', '.git-credentials'),
            gitConfigPath: join(root, 'pi-state', 'home', '.gitconfig'),
        })
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
                sandbox: sandbox(),
                roomConfiguration: roomConfiguration(),
            })

            expect(profile.env).toMatchObject({
                AGENT_ROOM_PI_RUNTIME_CONFIG_PATH: paths.runtimeConfigPath,
                AGENT_ROOM_PI_RUNTIME_TOKEN: 'token-token-token-token-token',
                AGENT_ROOM_PI_STATE_DIR: paths.engineStateDir,
                PI_CODING_AGENT_DIR: paths.engineStateDir,
                WORKSPACE_DIR: paths.workspaceDir,
                STORE_DIR: paths.storeDir,
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

    it('keeps search credential env keys explicit without storing credential values in config', async () => {
        const root = await mkdtemp(join(tmpdir(), 'agent-room-pi-profile-'))
        try {
            const config = roomConfiguration()
            config.search = {
                ...testSearch,
                brave: {
                    ...testSearch.brave,
                    enabled: true,
                    envKey: 'AGENT_ROOM_SEARCH_BRAVE_API_KEY',
                },
            }
            config.entitlements.env = {
                AGENT_ROOM_SEARCH_BRAVE_API_KEY: 'brave-secret',
            }

            const profile = piRuntimeEngineProfile.buildRuntimeProfile({
                roomId: 'room-1',
                displayName: 'Room One',
                port: 31234,
                token: 'token-token-token-token-token',
                paths: roomPaths(root),
                sandbox: sandbox(),
                roomConfiguration: config,
            })
            const runtimeConfig = profile.config as ReturnType<typeof buildPiRuntimeConfig>

            expect(runtimeConfig.search.brave).toMatchObject({
                enabled: true,
                envKey: 'AGENT_ROOM_SEARCH_BRAVE_API_KEY',
            })
            expect(JSON.stringify(runtimeConfig)).not.toContain('brave-secret')
            expect(profile.env.AGENT_ROOM_SEARCH_BRAVE_API_KEY).toBe('brave-secret')
        } finally {
            await rm(root, {
                recursive: true,
                force: true,
            })
        }
    })

    it('allows internally materialized GitHub tokens while keeping user env reserved', async () => {
        const root = await mkdtemp(join(tmpdir(), 'agent-room-pi-profile-'))
        try {
            const config = roomConfiguration()
            config.entitlements.internalEnv = {
                AGENT_ROOM_GITHUB_INSTALLATION_TOKEN: 'github-installation-token',
            }
            config.entitlements.github = {
                enabled: true,
                installationId: '123',
                accountLogin: 'agent-room',
                repositories: ['agent-room/example'],
                tokenEnvKey: 'AGENT_ROOM_GITHUB_INSTALLATION_TOKEN',
                tokenExpiresAt: '2026-05-11T12:00:00.000Z',
                ghHostsPath: null,
                gitCredentialsPath: null,
                gitConfigPath: null,
            }

            const profile = piRuntimeEngineProfile.buildRuntimeProfile({
                roomId: 'room-1',
                displayName: 'Room One',
                port: 31234,
                token: 'token-token-token-token-token',
                paths: roomPaths(root),
                sandbox: sandbox(),
                roomConfiguration: config,
            })

            expect(profile.env.AGENT_ROOM_GITHUB_INSTALLATION_TOKEN).toBe(
                'github-installation-token',
            )
        } finally {
            await rm(root, {
                recursive: true,
                force: true,
            })
        }
    })

    it('starts the Pi wrapper with Bun env-file loading disabled', () => {
        expect(piRuntimeEngineProfile.resolveCommand()).toMatchObject({
            command: 'bun',
            args: ['--no-env-file', 'run', join(process.cwd(), 'src/server/pi-runtime/main.ts')],
        })
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
                    sandbox: sandbox(),
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
