import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
    AppGitHubAppRecord,
    AppGitHubInstallationRecord,
    AppGitHubManifestSessionRecord,
    AppGitHubUserAuthSessionRecord,
    AppGitHubUserConnectionRecord,
    RoomGitHubBindingRecord,
    SecretRecord,
} from '#/domain/domain-types'

const mocks = vi.hoisted(() => ({
    state: {
        app: null as AppGitHubAppRecord | null,
        installation: null as AppGitHubInstallationRecord | null,
        session: null as AppGitHubManifestSessionRecord | null,
        userAuthSession: null as AppGitHubUserAuthSessionRecord | null,
        userConnection: null as AppGitHubUserConnectionRecord | null,
        binding: null as RoomGitHubBindingRecord | null,
        audits: [] as { action: string; payload: unknown }[],
        sessionStatusUpdates: [] as string[],
        userSessionStatusUpdates: [] as string[],
        deletedSecretIds: [] as string[],
    },
}))

function now(): Date {
    return new Date('2026-05-13T06:19:19.000Z')
}

function secret(id: string): SecretRecord {
    return {
        id,
        keyName: id,
        cipherText: Buffer.alloc(0),
        nonce: Buffer.alloc(0),
        authTag: Buffer.alloc(0),
        keyVersion: 1,
        createdAt: now(),
        updatedAt: now(),
    }
}

function readyApp(): AppGitHubAppRecord {
    return {
        id: true,
        appId: '3697071',
        slug: 'agent-room',
        name: 'Agent Room',
        clientId: 'client-id',
        clientSecretSecretId: 'client-secret-secret',
        privateKeySecretId: 'private-key-secret',
        webhookSecretSecretId: null,
        htmlUrl: 'https://github.com/apps/agent-room',
        status: 'ready',
        validationMessage: null,
        lastValidatedAt: now(),
        createdByUserId: 'user-1',
        createdAt: now(),
        updatedAt: now(),
    }
}

function readyInstallation(): AppGitHubInstallationRecord {
    return {
        installationId: '123',
        accountLogin: 'agent-room',
        accountType: 'Organization',
        targetType: 'Organization',
        htmlUrl: 'https://github.com/organizations/agent-room/settings/installations/123',
        repositorySelection: 'selected',
        permissions: {
            contents: 'write',
            metadata: 'read',
            pull_requests: 'write',
            issues: 'write',
        },
        suspendedAt: null,
        status: 'ready',
        lastSyncedAt: now(),
        createdAt: now(),
        updatedAt: now(),
    }
}

function response(payload: unknown, status = 200): Response {
    return new Response(JSON.stringify(payload), {
        status,
        headers: {
            'content-type': 'application/json',
        },
    })
}

vi.mock('../config/env', () => ({
    getAppEnv: () => ({
        encryptionKey: Buffer.alloc(32),
    }),
}))

vi.mock('./operator-configuration/secrets', () => ({
    upsertEncryptedSecret: vi.fn(async (input: { keyName: string }) => secret(input.keyName)),
    resolveSecret: vi.fn(async (id: string | null) => (id ? secret(id) : null)),
    decryptSecretRecord: vi.fn(() => 'private-key'),
}))

vi.mock('./github-app-helpers', async (importOriginal) => {
    const actual = await importOriginal()
    return {
        ...(actual as object),
        createGithubJwt: vi.fn(() => 'github-jwt'),
    }
})

vi.mock('../db/repositories', () => ({
    appGitHubManifestSessionRepository: {
        create: vi.fn(),
        findByStateHash: vi.fn(async () => mocks.state.session),
        updateStatus: vi.fn(
            async (_stateHash: string, status: AppGitHubManifestSessionRecord['status']) => {
                mocks.state.sessionStatusUpdates.push(status)
                if (mocks.state.session) {
                    mocks.state.session = {
                        ...mocks.state.session,
                        status,
                        updatedAt: now(),
                    }
                }
            },
        ),
        updateStatusIfCurrent: vi.fn(
            async (input: {
                currentStatus: AppGitHubManifestSessionRecord['status']
                nextStatus: AppGitHubManifestSessionRecord['status']
            }) => {
                if (!mocks.state.session || mocks.state.session.status !== input.currentStatus) {
                    return false
                }
                mocks.state.sessionStatusUpdates.push(input.nextStatus)
                mocks.state.session = {
                    ...mocks.state.session,
                    status: input.nextStatus,
                    updatedAt: now(),
                }
                return true
            },
        ),
    },
    appGitHubAppRepository: {
        get: vi.fn(async () => mocks.state.app),
        upsert: vi.fn(async (input: Omit<AppGitHubAppRecord, 'id' | 'createdAt' | 'updatedAt'>) => {
            const saved = {
                id: true,
                ...input,
                createdAt: now(),
                updatedAt: now(),
            }
            mocks.state.app = saved
            return saved
        }),
        delete: vi.fn(),
    },
    appGitHubInstallationRepository: {
        list: vi.fn(async () => (mocks.state.installation ? [mocks.state.installation] : [])),
        findById: vi.fn(async (installationId: string) =>
            mocks.state.installation?.installationId === installationId
                ? mocks.state.installation
                : null,
        ),
        upsert: vi.fn(),
        markMissingInvalid: vi.fn(async () => 0),
        deleteAll: vi.fn(),
    },
    appGitHubUserAuthSessionRepository: {
        create: vi.fn(),
        findByStateHash: vi.fn(async () => mocks.state.userAuthSession),
        updateStatus: vi.fn(
            async (_stateHash: string, status: AppGitHubUserAuthSessionRecord['status']) => {
                mocks.state.userSessionStatusUpdates.push(status)
                if (mocks.state.userAuthSession) {
                    mocks.state.userAuthSession = {
                        ...mocks.state.userAuthSession,
                        status,
                        updatedAt: now(),
                    }
                }
            },
        ),
        updateStatusIfCurrent: vi.fn(
            async (input: {
                currentStatus: AppGitHubUserAuthSessionRecord['status']
                nextStatus: AppGitHubUserAuthSessionRecord['status']
            }) => {
                if (
                    !mocks.state.userAuthSession ||
                    mocks.state.userAuthSession.status !== input.currentStatus
                ) {
                    return false
                }
                mocks.state.userSessionStatusUpdates.push(input.nextStatus)
                mocks.state.userAuthSession = {
                    ...mocks.state.userAuthSession,
                    status: input.nextStatus,
                    updatedAt: now(),
                }
                return true
            },
        ),
    },
    appGitHubUserConnectionRepository: {
        get: vi.fn(async () => mocks.state.userConnection),
        upsert: vi.fn(
            async (
                input: Omit<AppGitHubUserConnectionRecord, 'id' | 'createdAt' | 'updatedAt'>,
            ) => {
                const saved = {
                    id: true,
                    ...input,
                    createdAt: now(),
                    updatedAt: now(),
                }
                mocks.state.userConnection = saved
                return saved
            },
        ),
        delete: vi.fn(),
    },
    auditRepository: {
        appendEvent: vi.fn(async (input: { action: string; payload: unknown }) => {
            mocks.state.audits.push({
                action: input.action,
                payload: input.payload,
            })
            return input
        }),
    },
    roomGitHubBindingRepository: {
        findByRoomId: vi.fn(async (roomId: string) =>
            mocks.state.binding?.roomId === roomId ? mocks.state.binding : null,
        ),
        upsert: vi.fn(
            async (
                input: Omit<RoomGitHubBindingRecord, 'createdAt' | 'updatedAt'>,
            ): Promise<RoomGitHubBindingRecord> => {
                const binding = {
                    ...input,
                    createdAt: now(),
                    updatedAt: now(),
                }
                mocks.state.binding = binding
                return binding
            },
        ),
        deleteByRoomId: vi.fn(async (roomId: string) => {
            if (mocks.state.binding?.roomId === roomId) {
                mocks.state.binding = null
            }
        }),
        deleteAll: vi.fn(),
    },
    secretRepository: {
        deleteById: vi.fn(async (id: string) => {
            mocks.state.deletedSecretIds.push(id)
        }),
    },
}))

describe('completeGitHubAppManifest', () => {
    beforeEach(() => {
        vi.useFakeTimers({
            now: now(),
        })
        mocks.state.app = null
        mocks.state.installation = null
        mocks.state.binding = null
        mocks.state.userAuthSession = null
        mocks.state.userConnection = null
        mocks.state.session = {
            stateHash: 'hashed-state',
            actorUserId: 'user-1',
            publicOrigin: 'https://agent-room.example.com',
            targetOwner: null,
            status: 'pending',
            expiresAt: new Date('2026-05-13T07:19:19.000Z'),
            createdAt: now(),
            updatedAt: now(),
        }
        mocks.state.audits = []
        mocks.state.sessionStatusUpdates = []
        mocks.state.userSessionStatusUpdates = []
        mocks.state.deletedSecretIds = []
        vi.stubGlobal(
            'fetch',
            vi.fn(async (url: string | URL | Request) => {
                const href = String(url)
                if (href.includes('/app-manifests/')) {
                    return response({
                        id: 3697071,
                        slug: 'agent-room',
                        name: 'Agent Room',
                        client_id: 'client-id',
                        client_secret: 'client-secret',
                        pem: 'private-key',
                        webhook_secret: 'webhook-secret',
                        html_url: 'https://github.com/apps/agent-room',
                    })
                }
                if (href.includes('/app/installations')) {
                    return response(
                        {
                            message: 'Integration not found',
                        },
                        404,
                    )
                }
                return response(
                    {
                        message: 'Unexpected GitHub request',
                    },
                    500,
                )
            }),
        )
    })

    afterEach(() => {
        vi.useRealTimers()
    })

    it('keeps manifest setup complete when immediate installation sync hits GitHub propagation', async () => {
        const { completeGitHubAppManifest } = await import('./github-app')

        const result = await completeGitHubAppManifest({
            code: 'manifest-code',
            state: 'manifest-state',
            actorUserId: 'user-1',
        })

        expect(result.app.configured).toBe(true)
        expect(result.installations).toEqual([])
        expect(mocks.state.sessionStatusUpdates).toEqual(['completed'])
        expect(mocks.state.audits.map((event) => event.action)).toEqual([
            'github_app.configured',
            'github_installations.initial_sync_failed',
        ])
        expect(mocks.state.audits[1]?.payload).toMatchObject({
            appId: '3697071',
            slug: 'agent-room',
            message: 'Integration not found',
            status: 404,
        })
    })

    it('connects a GitHub user through the interactive app OAuth callback', async () => {
        mocks.state.app = readyApp()
        mocks.state.userAuthSession = {
            stateHash: 'hashed-user-state',
            actorUserId: 'user-1',
            publicOrigin: 'https://agent-room.example.com',
            codeVerifier: 'verifier',
            status: 'pending',
            expiresAt: new Date('2026-05-13T07:19:19.000Z'),
            createdAt: now(),
            updatedAt: now(),
        }
        vi.stubGlobal(
            'fetch',
            vi.fn(async (url: string | URL | Request) => {
                const href = String(url)
                if (href.includes('/login/oauth/access_token')) {
                    return response({
                        access_token: 'user-token',
                        token_type: 'bearer',
                        refresh_token: 'refresh-token',
                        expires_in: 28800,
                        refresh_token_expires_in: 15897600,
                    })
                }
                if (href.endsWith('/user')) {
                    return response({
                        id: 123,
                        login: 'test-user',
                        name: 'Test User',
                        avatar_url: 'https://avatars.githubusercontent.com/u/123',
                        html_url: 'https://github.com/test-user',
                        type: 'User',
                    })
                }
                if (href.includes('/user/orgs')) {
                    return response([
                        {
                            login: 'example-org',
                            avatar_url: 'https://avatars.githubusercontent.com/u/456',
                            html_url: 'https://github.com/example-org',
                            type: 'Organization',
                        },
                    ])
                }
                if (href.includes('/user/installations')) {
                    return response({
                        total_count: 0,
                        installations: [],
                    })
                }
                if (href.includes('/app/installations')) {
                    return response([])
                }
                return response(
                    {
                        message: 'Unexpected GitHub request',
                    },
                    500,
                )
            }),
        )
        const { completeGitHubUserAuthorization } = await import('./github-app')

        const result = await completeGitHubUserAuthorization({
            code: 'oauth-code',
            state: 'user-state',
            actorUserId: 'user-1',
        })

        expect(result.user.connected).toBe(true)
        expect(result.user.login).toBe('test-user')
        expect(result.accounts.map((account) => account.login)).toEqual([
            'example-org',
            'test-user',
        ])
        expect(mocks.state.userSessionStatusUpdates).toEqual(['completed'])
        expect(mocks.state.audits.map((event) => event.action)).toContain('github_user.connected')
    })
})

describe('room GitHub bindings', () => {
    beforeEach(() => {
        vi.useFakeTimers({
            now: now(),
        })
        mocks.state.app = readyApp()
        mocks.state.installation = readyInstallation()
        mocks.state.binding = null
        mocks.state.userAuthSession = null
        mocks.state.userConnection = null
        mocks.state.session = null
        mocks.state.audits = []
        mocks.state.sessionStatusUpdates = []
        mocks.state.userSessionStatusUpdates = []
        mocks.state.deletedSecretIds = []
        vi.stubGlobal(
            'fetch',
            vi.fn(async (url: string | URL | Request) => {
                const href = String(url)
                if (href.includes('/app/installations/123/access_tokens')) {
                    return response({
                        token: 'installation-token',
                        expires_at: '2026-05-13T07:19:19.000Z',
                    })
                }
                return response(
                    {
                        message: 'Unexpected GitHub request',
                    },
                    500,
                )
            }),
        )
    })

    afterEach(() => {
        vi.useRealTimers()
    })

    it('saves, reports, and materializes room GitHub access without a mode gate', async () => {
        const { saveRoomGitHubBinding, resolveRoomGitHubStatus, materializeRoomGitHubBinding } =
            await import('./github-app')

        const saved = await saveRoomGitHubBinding({
            roomId: 'room-1',
            enabled: true,
            installationId: '123',
            repositories: ['agent-room/example'],
            actorUserId: 'user-1',
        })
        const status = await resolveRoomGitHubStatus({
            binding: mocks.state.binding,
        })
        const materialized = await materializeRoomGitHubBinding({
            binding: mocks.state.binding,
        })

        expect(saved).toEqual({
            enabled: true,
            installationId: '123',
            repositories: ['agent-room/example'],
        })
        expect(status).toMatchObject({
            ready: true,
            enabled: true,
            installationId: '123',
            accountLogin: 'agent-room',
            repositories: ['agent-room/example'],
        })
        expect(materialized.internalEnv).toEqual({
            AGENT_ROOM_GITHUB_INSTALLATION_TOKEN: 'installation-token',
        })
        expect(materialized.github).toMatchObject({
            enabled: true,
            installationId: '123',
            accountLogin: 'agent-room',
            repositories: ['agent-room/example'],
            tokenEnvKey: 'AGENT_ROOM_GITHUB_INSTALLATION_TOKEN',
            tokenExpiresAt: '2026-05-13T07:19:19.000Z',
        })
    })
})
