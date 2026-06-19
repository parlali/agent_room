import { and, asc, desc, eq, ne, notInArray } from 'drizzle-orm'
import type {
    AppGitHubAppRecord,
    AppGitHubInstallationRecord,
    AppGitHubManifestSessionRecord,
    AppGitHubUserAuthSessionRecord,
    AppGitHubUserConnectionRecord,
    ConnectionStatus,
    JsonValue,
    RoomGitHubBindingRecord,
} from '#/domain/domain-types'
import {
    appGithubApps,
    appGithubInstallations,
    appGithubManifestSessions,
    appGithubUserAuthSessions,
    appGithubUserConnections,
    roomGithubBindings,
} from '../schema'
import {
    mapAppGitHubApp,
    mapAppGitHubInstallation,
    mapAppGitHubManifestSession,
    mapAppGitHubUserAuthSession,
    mapAppGitHubUserConnection,
    mapRoomGitHubBinding,
} from './row-mappers'
import { excluded, nowDate, repositoryDatabase } from './repository-utils'

export const appGitHubManifestSessionRepository = {
    async create(input: {
        stateHash: string
        actorUserId: string
        publicOrigin: string
        targetOwner: string | null
        expiresAt: Date
    }): Promise<AppGitHubManifestSessionRecord> {
        const db = await repositoryDatabase()
        const now = nowDate()
        const [row] = await db
            .insert(appGithubManifestSessions)
            .values({
                stateHash: input.stateHash,
                actorUserId: input.actorUserId,
                publicOrigin: input.publicOrigin,
                targetOwner: input.targetOwner,
                status: 'pending',
                expiresAt: input.expiresAt,
                createdAt: now,
                updatedAt: now,
            })
            .returning()
        return mapAppGitHubManifestSession(row)
    },

    async findByStateHash(stateHash: string): Promise<AppGitHubManifestSessionRecord | null> {
        const db = await repositoryDatabase()
        const [row] = await db
            .select()
            .from(appGithubManifestSessions)
            .where(eq(appGithubManifestSessions.stateHash, stateHash))
            .limit(1)
        return row ? mapAppGitHubManifestSession(row) : null
    },

    async updateStatus(
        stateHash: string,
        status: AppGitHubManifestSessionRecord['status'],
    ): Promise<void> {
        const db = await repositoryDatabase()
        await db
            .update(appGithubManifestSessions)
            .set({
                status,
                updatedAt: nowDate(),
            })
            .where(eq(appGithubManifestSessions.stateHash, stateHash))
    },

    async updateStatusIfCurrent(input: {
        stateHash: string
        currentStatus: AppGitHubManifestSessionRecord['status']
        nextStatus: AppGitHubManifestSessionRecord['status']
    }): Promise<boolean> {
        const db = await repositoryDatabase()
        const rows = await db
            .update(appGithubManifestSessions)
            .set({
                status: input.nextStatus,
                updatedAt: nowDate(),
            })
            .where(
                and(
                    eq(appGithubManifestSessions.stateHash, input.stateHash),
                    eq(appGithubManifestSessions.status, input.currentStatus),
                ),
            )
            .returning({ stateHash: appGithubManifestSessions.stateHash })
        return rows.length > 0
    },
}

export const appGitHubAppRepository = {
    async get(): Promise<AppGitHubAppRecord | null> {
        const db = await repositoryDatabase()
        const [row] = await db
            .select()
            .from(appGithubApps)
            .where(eq(appGithubApps.id, true))
            .limit(1)
        return row ? mapAppGitHubApp(row) : null
    },

    async upsert(input: {
        appId: string
        slug: string
        name: string
        clientId: string
        clientSecretSecretId: string
        privateKeySecretId: string
        webhookSecretSecretId: string | null
        htmlUrl: string | null
        status: ConnectionStatus
        validationMessage: string | null
        lastValidatedAt: Date | null
        createdByUserId: string | null
    }): Promise<AppGitHubAppRecord> {
        const db = await repositoryDatabase()
        const now = nowDate()
        const [row] = await db
            .insert(appGithubApps)
            .values({
                id: true,
                appId: input.appId,
                slug: input.slug,
                name: input.name,
                clientId: input.clientId,
                clientSecretSecretId: input.clientSecretSecretId,
                privateKeySecretId: input.privateKeySecretId,
                webhookSecretSecretId: input.webhookSecretSecretId,
                htmlUrl: input.htmlUrl,
                status: input.status,
                validationMessage: input.validationMessage,
                lastValidatedAt: input.lastValidatedAt,
                createdByUserId: input.createdByUserId,
                createdAt: now,
                updatedAt: now,
            })
            .onConflictDoUpdate({
                target: appGithubApps.id,
                set: {
                    appId: excluded('app_id'),
                    slug: excluded('slug'),
                    name: excluded('name'),
                    clientId: excluded('client_id'),
                    clientSecretSecretId: excluded('client_secret_secret_id'),
                    privateKeySecretId: excluded('private_key_secret_id'),
                    webhookSecretSecretId: excluded('webhook_secret_secret_id'),
                    htmlUrl: excluded('html_url'),
                    status: excluded('status'),
                    validationMessage: excluded('validation_message'),
                    lastValidatedAt: excluded('last_validated_at'),
                    updatedAt: now,
                },
            })
            .returning()
        return mapAppGitHubApp(row)
    },

    async delete(): Promise<void> {
        const db = await repositoryDatabase()
        await db.delete(appGithubApps).where(eq(appGithubApps.id, true))
    },
}

export const appGitHubUserAuthSessionRepository = {
    async create(input: {
        stateHash: string
        actorUserId: string
        publicOrigin: string
        codeVerifier: string
        expiresAt: Date
    }): Promise<AppGitHubUserAuthSessionRecord> {
        const db = await repositoryDatabase()
        const now = nowDate()
        const [row] = await db
            .insert(appGithubUserAuthSessions)
            .values({
                stateHash: input.stateHash,
                actorUserId: input.actorUserId,
                publicOrigin: input.publicOrigin,
                codeVerifier: input.codeVerifier,
                status: 'pending',
                expiresAt: input.expiresAt,
                createdAt: now,
                updatedAt: now,
            })
            .returning()
        return mapAppGitHubUserAuthSession(row)
    },

    async findByStateHash(stateHash: string): Promise<AppGitHubUserAuthSessionRecord | null> {
        const db = await repositoryDatabase()
        const [row] = await db
            .select()
            .from(appGithubUserAuthSessions)
            .where(eq(appGithubUserAuthSessions.stateHash, stateHash))
            .limit(1)
        return row ? mapAppGitHubUserAuthSession(row) : null
    },

    async updateStatus(
        stateHash: string,
        status: AppGitHubUserAuthSessionRecord['status'],
    ): Promise<void> {
        const db = await repositoryDatabase()
        await db
            .update(appGithubUserAuthSessions)
            .set({
                status,
                updatedAt: nowDate(),
            })
            .where(eq(appGithubUserAuthSessions.stateHash, stateHash))
    },

    async updateStatusIfCurrent(input: {
        stateHash: string
        currentStatus: AppGitHubUserAuthSessionRecord['status']
        nextStatus: AppGitHubUserAuthSessionRecord['status']
    }): Promise<boolean> {
        const db = await repositoryDatabase()
        const rows = await db
            .update(appGithubUserAuthSessions)
            .set({
                status: input.nextStatus,
                updatedAt: nowDate(),
            })
            .where(
                and(
                    eq(appGithubUserAuthSessions.stateHash, input.stateHash),
                    eq(appGithubUserAuthSessions.status, input.currentStatus),
                ),
            )
            .returning({ stateHash: appGithubUserAuthSessions.stateHash })
        return rows.length > 0
    },
}

export const appGitHubUserConnectionRepository = {
    async get(): Promise<AppGitHubUserConnectionRecord | null> {
        const db = await repositoryDatabase()
        const [row] = await db
            .select()
            .from(appGithubUserConnections)
            .where(eq(appGithubUserConnections.id, true))
            .limit(1)
        return row ? mapAppGitHubUserConnection(row) : null
    },

    async upsert(input: {
        githubUserId: string
        login: string
        name: string | null
        avatarUrl: string | null
        htmlUrl: string | null
        tokenType: string
        accessTokenSecretId: string
        accessTokenExpiresAt: Date | null
        refreshTokenSecretId: string | null
        refreshTokenExpiresAt: Date | null
        createdByUserId: string | null
        lastAuthorizedAt: Date
    }): Promise<AppGitHubUserConnectionRecord> {
        const db = await repositoryDatabase()
        const now = nowDate()
        const [row] = await db
            .insert(appGithubUserConnections)
            .values({
                id: true,
                githubUserId: input.githubUserId,
                login: input.login,
                name: input.name,
                avatarUrl: input.avatarUrl,
                htmlUrl: input.htmlUrl,
                tokenType: input.tokenType,
                accessTokenSecretId: input.accessTokenSecretId,
                accessTokenExpiresAt: input.accessTokenExpiresAt,
                refreshTokenSecretId: input.refreshTokenSecretId,
                refreshTokenExpiresAt: input.refreshTokenExpiresAt,
                createdByUserId: input.createdByUserId,
                lastAuthorizedAt: input.lastAuthorizedAt,
                createdAt: now,
                updatedAt: now,
            })
            .onConflictDoUpdate({
                target: appGithubUserConnections.id,
                set: {
                    githubUserId: excluded('github_user_id'),
                    login: excluded('login'),
                    name: excluded('name'),
                    avatarUrl: excluded('avatar_url'),
                    htmlUrl: excluded('html_url'),
                    tokenType: excluded('token_type'),
                    accessTokenSecretId: excluded('access_token_secret_id'),
                    accessTokenExpiresAt: excluded('access_token_expires_at'),
                    refreshTokenSecretId: excluded('refresh_token_secret_id'),
                    refreshTokenExpiresAt: excluded('refresh_token_expires_at'),
                    lastAuthorizedAt: excluded('last_authorized_at'),
                    updatedAt: now,
                },
            })
            .returning()
        return mapAppGitHubUserConnection(row)
    },

    async delete(): Promise<void> {
        const db = await repositoryDatabase()
        await db.delete(appGithubUserConnections).where(eq(appGithubUserConnections.id, true))
    },
}

export const appGitHubInstallationRepository = {
    async list(): Promise<AppGitHubInstallationRecord[]> {
        const db = await repositoryDatabase()
        const rows = await db
            .select()
            .from(appGithubInstallations)
            .orderBy(
                asc(appGithubInstallations.accountLogin),
                asc(appGithubInstallations.installationId),
            )
        return rows.map(mapAppGitHubInstallation)
    },

    async findById(installationId: string): Promise<AppGitHubInstallationRecord | null> {
        const db = await repositoryDatabase()
        const [row] = await db
            .select()
            .from(appGithubInstallations)
            .where(eq(appGithubInstallations.installationId, installationId))
            .limit(1)
        return row ? mapAppGitHubInstallation(row) : null
    },

    async upsert(input: {
        installationId: string
        accountLogin: string
        accountType: string
        targetType: string | null
        htmlUrl: string | null
        repositorySelection: string
        permissions: JsonValue
        suspendedAt: Date | null
        status: ConnectionStatus
        lastSyncedAt: Date
    }): Promise<AppGitHubInstallationRecord> {
        const db = await repositoryDatabase()
        const now = nowDate()
        const [row] = await db
            .insert(appGithubInstallations)
            .values({
                installationId: input.installationId,
                accountLogin: input.accountLogin,
                accountType: input.accountType,
                targetType: input.targetType,
                htmlUrl: input.htmlUrl,
                repositorySelection: input.repositorySelection,
                permissions: input.permissions,
                suspendedAt: input.suspendedAt,
                status: input.status,
                lastSyncedAt: input.lastSyncedAt,
                createdAt: now,
                updatedAt: now,
            })
            .onConflictDoUpdate({
                target: appGithubInstallations.installationId,
                set: {
                    accountLogin: excluded('account_login'),
                    accountType: excluded('account_type'),
                    targetType: excluded('target_type'),
                    htmlUrl: excluded('html_url'),
                    repositorySelection: excluded('repository_selection'),
                    permissions: excluded('permissions'),
                    suspendedAt: excluded('suspended_at'),
                    status: excluded('status'),
                    lastSyncedAt: excluded('last_synced_at'),
                    updatedAt: now,
                },
            })
            .returning()
        return mapAppGitHubInstallation(row)
    },

    async markMissingInvalid(input: {
        activeInstallationIds: string[]
        lastSyncedAt: Date
    }): Promise<number> {
        const db = await repositoryDatabase()
        const baseCondition = ne(appGithubInstallations.status, 'invalid')
        const condition =
            input.activeInstallationIds.length === 0
                ? baseCondition
                : and(
                      notInArray(
                          appGithubInstallations.installationId,
                          input.activeInstallationIds,
                      ),
                      baseCondition,
                  )
        const rows = await db
            .update(appGithubInstallations)
            .set({
                status: 'invalid',
                lastSyncedAt: input.lastSyncedAt,
                updatedAt: nowDate(),
            })
            .where(condition)
            .returning({ installationId: appGithubInstallations.installationId })
        return rows.length
    },

    async deleteAll(): Promise<void> {
        const db = await repositoryDatabase()
        await db.delete(appGithubInstallations)
    },
}

export const roomGitHubBindingRepository = {
    async findByRoomId(roomId: string): Promise<RoomGitHubBindingRecord | null> {
        const db = await repositoryDatabase()
        const [row] = await db
            .select()
            .from(roomGithubBindings)
            .where(eq(roomGithubBindings.roomId, roomId))
            .limit(1)
        return row ? mapRoomGitHubBinding(row) : null
    },

    async listByInstallationId(installationId: string): Promise<RoomGitHubBindingRecord[]> {
        const db = await repositoryDatabase()
        const rows = await db
            .select()
            .from(roomGithubBindings)
            .where(eq(roomGithubBindings.installationId, installationId))
            .orderBy(desc(roomGithubBindings.updatedAt))
        return rows.map(mapRoomGitHubBinding)
    },

    async upsert(input: {
        roomId: string
        installationId: string
        repositories: JsonValue
        enabled: boolean
        createdByUserId: string | null
    }): Promise<RoomGitHubBindingRecord> {
        const db = await repositoryDatabase()
        const now = nowDate()
        const [row] = await db
            .insert(roomGithubBindings)
            .values({
                roomId: input.roomId,
                installationId: input.installationId,
                repositories: input.repositories,
                enabled: input.enabled,
                createdByUserId: input.createdByUserId,
                createdAt: now,
                updatedAt: now,
            })
            .onConflictDoUpdate({
                target: roomGithubBindings.roomId,
                set: {
                    installationId: excluded('installation_id'),
                    repositories: excluded('repositories'),
                    enabled: excluded('enabled'),
                    updatedAt: now,
                },
            })
            .returning()
        return mapRoomGitHubBinding(row)
    },

    async deleteByRoomId(roomId: string): Promise<void> {
        const db = await repositoryDatabase()
        await db.delete(roomGithubBindings).where(eq(roomGithubBindings.roomId, roomId))
    },

    async deleteAll(): Promise<void> {
        const db = await repositoryDatabase()
        await db.delete(roomGithubBindings)
    },
}
