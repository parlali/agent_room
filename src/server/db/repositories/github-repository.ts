import type {
    AppGitHubAppRecord,
    AppGitHubInstallationRecord,
    AppGitHubManifestSessionRecord,
    ConnectionStatus,
    JsonValue,
    RoomGitHubBindingRecord,
} from '../../domain/types'
import { sql } from '../client'
import {
    mapAppGitHubApp,
    mapAppGitHubInstallation,
    mapAppGitHubManifestSession,
    mapRoomGitHubBinding,
} from './row-mappers'

export const appGitHubManifestSessionRepository = {
    async create(input: {
        stateHash: string
        actorUserId: string
        publicOrigin: string
        targetOwner: string | null
        expiresAt: Date
    }): Promise<AppGitHubManifestSessionRecord> {
        const rows = await sql`
            INSERT INTO app_github_manifest_sessions (
                state_hash,
                actor_user_id,
                public_origin,
                target_owner,
                status,
                expires_at,
                created_at,
                updated_at
            )
            VALUES (
                ${input.stateHash},
                ${input.actorUserId},
                ${input.publicOrigin},
                ${input.targetOwner},
                'pending',
                ${input.expiresAt},
                now(),
                now()
            )
            RETURNING *
        `
        return mapAppGitHubManifestSession(rows[0] as Record<string, unknown>)
    },

    async findByStateHash(stateHash: string): Promise<AppGitHubManifestSessionRecord | null> {
        const rows = await sql`
            SELECT *
            FROM app_github_manifest_sessions
            WHERE state_hash = ${stateHash}
            LIMIT 1
        `
        if (rows.length === 0) {
            return null
        }
        return mapAppGitHubManifestSession(rows[0] as Record<string, unknown>)
    },

    async updateStatus(
        stateHash: string,
        status: AppGitHubManifestSessionRecord['status'],
    ): Promise<void> {
        await sql`
            UPDATE app_github_manifest_sessions
            SET
                status = ${status},
                updated_at = now()
            WHERE state_hash = ${stateHash}
        `
    },
}

export const appGitHubAppRepository = {
    async get(): Promise<AppGitHubAppRecord | null> {
        const rows = await sql`
            SELECT *
            FROM app_github_apps
            WHERE id = true
            LIMIT 1
        `
        if (rows.length === 0) {
            return null
        }
        return mapAppGitHubApp(rows[0] as Record<string, unknown>)
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
        const rows = await sql`
            INSERT INTO app_github_apps (
                id,
                app_id,
                slug,
                name,
                client_id,
                client_secret_secret_id,
                private_key_secret_id,
                webhook_secret_secret_id,
                html_url,
                status,
                validation_message,
                last_validated_at,
                created_by_user_id,
                created_at,
                updated_at
            )
            VALUES (
                true,
                ${input.appId},
                ${input.slug},
                ${input.name},
                ${input.clientId},
                ${input.clientSecretSecretId},
                ${input.privateKeySecretId},
                ${input.webhookSecretSecretId},
                ${input.htmlUrl},
                ${input.status},
                ${input.validationMessage},
                ${input.lastValidatedAt},
                ${input.createdByUserId},
                now(),
                now()
            )
            ON CONFLICT (id)
            DO UPDATE SET
                app_id = excluded.app_id,
                slug = excluded.slug,
                name = excluded.name,
                client_id = excluded.client_id,
                client_secret_secret_id = excluded.client_secret_secret_id,
                private_key_secret_id = excluded.private_key_secret_id,
                webhook_secret_secret_id = excluded.webhook_secret_secret_id,
                html_url = excluded.html_url,
                status = excluded.status,
                validation_message = excluded.validation_message,
                last_validated_at = excluded.last_validated_at,
                updated_at = now()
            RETURNING *
        `
        return mapAppGitHubApp(rows[0] as Record<string, unknown>)
    },
}

export const appGitHubInstallationRepository = {
    async list(): Promise<AppGitHubInstallationRecord[]> {
        const rows = await sql`
            SELECT *
            FROM app_github_installations
            ORDER BY account_login ASC, installation_id ASC
        `
        return rows.map((row) => mapAppGitHubInstallation(row as Record<string, unknown>))
    },

    async findById(installationId: string): Promise<AppGitHubInstallationRecord | null> {
        const rows = await sql`
            SELECT *
            FROM app_github_installations
            WHERE installation_id = ${installationId}
            LIMIT 1
        `
        if (rows.length === 0) {
            return null
        }
        return mapAppGitHubInstallation(rows[0] as Record<string, unknown>)
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
        const rows = await sql`
            INSERT INTO app_github_installations (
                installation_id,
                account_login,
                account_type,
                target_type,
                html_url,
                repository_selection,
                permissions,
                suspended_at,
                status,
                last_synced_at,
                created_at,
                updated_at
            )
            VALUES (
                ${input.installationId},
                ${input.accountLogin},
                ${input.accountType},
                ${input.targetType},
                ${input.htmlUrl},
                ${input.repositorySelection},
                ${sql.json(input.permissions)},
                ${input.suspendedAt},
                ${input.status},
                ${input.lastSyncedAt},
                now(),
                now()
            )
            ON CONFLICT (installation_id)
            DO UPDATE SET
                account_login = excluded.account_login,
                account_type = excluded.account_type,
                target_type = excluded.target_type,
                html_url = excluded.html_url,
                repository_selection = excluded.repository_selection,
                permissions = excluded.permissions,
                suspended_at = excluded.suspended_at,
                status = excluded.status,
                last_synced_at = excluded.last_synced_at,
                updated_at = now()
            RETURNING *
        `
        return mapAppGitHubInstallation(rows[0] as Record<string, unknown>)
    },

    async markMissingInvalid(input: {
        activeInstallationIds: string[]
        lastSyncedAt: Date
    }): Promise<number> {
        const rows =
            input.activeInstallationIds.length === 0
                ? await sql`
                      UPDATE app_github_installations
                      SET
                          status = 'invalid',
                          last_synced_at = ${input.lastSyncedAt},
                          updated_at = now()
                      WHERE status <> 'invalid'
                      RETURNING installation_id
                  `
                : await sql`
                      UPDATE app_github_installations
                      SET
                          status = 'invalid',
                          last_synced_at = ${input.lastSyncedAt},
                          updated_at = now()
                      WHERE installation_id NOT IN ${sql(input.activeInstallationIds)}
                      AND status <> 'invalid'
                      RETURNING installation_id
                  `
        return rows.length
    },
}

export const roomGitHubBindingRepository = {
    async findByRoomId(roomId: string): Promise<RoomGitHubBindingRecord | null> {
        const rows = await sql`
            SELECT *
            FROM room_github_bindings
            WHERE room_id = ${roomId}
            LIMIT 1
        `
        if (rows.length === 0) {
            return null
        }
        return mapRoomGitHubBinding(rows[0] as Record<string, unknown>)
    },

    async listByInstallationId(installationId: string): Promise<RoomGitHubBindingRecord[]> {
        const rows = await sql`
            SELECT *
            FROM room_github_bindings
            WHERE installation_id = ${installationId}
            ORDER BY updated_at DESC
        `
        return rows.map((row) => mapRoomGitHubBinding(row as Record<string, unknown>))
    },

    async upsert(input: {
        roomId: string
        installationId: string
        repositories: JsonValue
        enabled: boolean
        createdByUserId: string | null
    }): Promise<RoomGitHubBindingRecord> {
        const rows = await sql`
            INSERT INTO room_github_bindings (
                room_id,
                installation_id,
                repositories,
                enabled,
                created_by_user_id,
                created_at,
                updated_at
            )
            VALUES (
                ${input.roomId},
                ${input.installationId},
                ${sql.json(input.repositories)},
                ${input.enabled},
                ${input.createdByUserId},
                now(),
                now()
            )
            ON CONFLICT (room_id)
            DO UPDATE SET
                installation_id = excluded.installation_id,
                repositories = excluded.repositories,
                enabled = excluded.enabled,
                updated_at = now()
            RETURNING *
        `
        return mapRoomGitHubBinding(rows[0] as Record<string, unknown>)
    },

    async deleteByRoomId(roomId: string): Promise<void> {
        await sql`
            DELETE FROM room_github_bindings
            WHERE room_id = ${roomId}
        `
    },
}
