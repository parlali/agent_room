import type {
    AppMcpConnectionRecord,
    AppProviderConnectionRecord,
    AppSettingsRecord,
    ConnectionStatus,
    JsonValue,
    McpAuthMode,
    McpTransport,
    ProviderAuthMode,
    ProviderApi,
    RoomConfigRecord,
    RoomMcpBindingRecord,
    RoomProviderMode,
    RoomSecretPurpose,
    RoomSecretRecord,
} from '#/domain/domain-types'
import { sql, withTransaction } from '../client'
import {
    mapAppMcpConnection,
    mapAppProviderConnection,
    mapAppSettings,
    mapRoomConfig,
    mapRoomMcpBinding,
    mapRoomSecret,
} from './row-mappers'

export const appProviderConnectionRepository = {
    async list(): Promise<AppProviderConnectionRecord[]> {
        const rows = await sql`
            SELECT *
            FROM app_provider_connections
            ORDER BY updated_at DESC
        `
        return rows.map((row) => mapAppProviderConnection(row as Record<string, unknown>))
    },

    async findById(id: string): Promise<AppProviderConnectionRecord | null> {
        const rows = await sql`
            SELECT *
            FROM app_provider_connections
            WHERE id = ${id}
            LIMIT 1
        `
        if (rows.length === 0) {
            return null
        }
        return mapAppProviderConnection(rows[0] as Record<string, unknown>)
    },

    async findByProvider(provider: string): Promise<AppProviderConnectionRecord | null> {
        const rows = await sql`
            SELECT *
            FROM app_provider_connections
            WHERE provider = ${provider}
            ORDER BY updated_at DESC
            LIMIT 1
        `
        if (rows.length === 0) {
            return null
        }
        return mapAppProviderConnection(rows[0] as Record<string, unknown>)
    },

    async countRoomReferences(id: string): Promise<number> {
        const rows = await sql`
            SELECT count(*)::int AS count
            FROM room_configs
            WHERE provider_connection_id = ${id}
        `
        return Number(rows[0]?.count ?? 0)
    },

    async deleteByIdIfUnused(id: string): Promise<boolean> {
        return withTransaction(async (trx) => {
            const rows = await trx`
                DELETE FROM app_provider_connections
                WHERE id = ${id}
                    AND NOT EXISTS (
                        SELECT 1
                        FROM room_configs
                        WHERE provider_connection_id = ${id}
                    )
                RETURNING id
            `
            if (rows.length === 0) {
                return false
            }
            await trx`
                UPDATE app_settings
                SET
                    default_model = NULL,
                    updated_at = now()
                WHERE id = true
                    AND default_provider_connection_id IS NULL
            `
            return true
        })
    },

    async upsert(input: {
        id: string
        label: string
        provider: string
        authMode: ProviderAuthMode
        api: ProviderApi
        baseUrl: string | null
        defaultModel: string
        fallbackModels: JsonValue
        credentialSecretId: string | null
        status: ConnectionStatus
        validationMessage: string | null
        lastValidatedAt: Date | null
        createdByUserId: string | null
    }): Promise<AppProviderConnectionRecord> {
        const rows = await sql`
            INSERT INTO app_provider_connections (
                id,
                label,
                provider,
                auth_mode,
                api,
                base_url,
                default_model,
                fallback_models,
                credential_secret_id,
                status,
                validation_message,
                last_validated_at,
                created_by_user_id,
                created_at,
                updated_at
            )
            VALUES (
                ${input.id},
                ${input.label},
                ${input.provider},
                ${input.authMode},
                ${input.api},
                ${input.baseUrl},
                ${input.defaultModel},
                ${sql.json(input.fallbackModels)},
                ${input.credentialSecretId},
                ${input.status},
                ${input.validationMessage},
                ${input.lastValidatedAt},
                ${input.createdByUserId},
                now(),
                now()
            )
            ON CONFLICT (id)
            DO UPDATE SET
                label = excluded.label,
                provider = excluded.provider,
                auth_mode = excluded.auth_mode,
                api = excluded.api,
                base_url = excluded.base_url,
                default_model = excluded.default_model,
                fallback_models = excluded.fallback_models,
                credential_secret_id = excluded.credential_secret_id,
                status = excluded.status,
                validation_message = excluded.validation_message,
                last_validated_at = excluded.last_validated_at,
                updated_at = now()
            RETURNING *
        `
        return mapAppProviderConnection(rows[0] as Record<string, unknown>)
    },

    async updateValidation(input: {
        id: string
        status: ConnectionStatus
        validationMessage: string | null
        lastValidatedAt: Date
    }): Promise<AppProviderConnectionRecord> {
        const rows = await sql`
            UPDATE app_provider_connections
            SET
                status = ${input.status},
                validation_message = ${input.validationMessage},
                last_validated_at = ${input.lastValidatedAt},
                updated_at = now()
            WHERE id = ${input.id}
            RETURNING *
        `
        if (rows.length === 0) {
            throw new Error('Provider connection does not exist')
        }
        return mapAppProviderConnection(rows[0] as Record<string, unknown>)
    },
}

export const appMcpConnectionRepository = {
    async list(): Promise<AppMcpConnectionRecord[]> {
        const rows = await sql`
            SELECT *
            FROM app_mcp_connections
            ORDER BY updated_at DESC
        `
        return rows.map((row) => mapAppMcpConnection(row as Record<string, unknown>))
    },

    async findById(id: string): Promise<AppMcpConnectionRecord | null> {
        const rows = await sql`
            SELECT *
            FROM app_mcp_connections
            WHERE id = ${id}
            LIMIT 1
        `
        if (rows.length === 0) {
            return null
        }
        return mapAppMcpConnection(rows[0] as Record<string, unknown>)
    },

    async countRoomBindings(id: string): Promise<number> {
        const rows = await sql`
            SELECT count(*)::int AS count
            FROM room_mcp_bindings
            WHERE mcp_connection_id = ${id}
        `
        return Number(rows[0]?.count ?? 0)
    },

    async deleteByIdIfUnused(id: string): Promise<boolean> {
        const rows = await sql`
            DELETE FROM app_mcp_connections
            WHERE id = ${id}
                AND NOT EXISTS (
                    SELECT 1
                    FROM room_mcp_bindings
                    WHERE mcp_connection_id = ${id}
                )
            RETURNING id
        `
        return rows.length > 0
    },

    async upsert(input: {
        id: string
        name: string
        serverKey: string
        transport: McpTransport
        command: string | null
        args: JsonValue
        url: string | null
        headers: JsonValue
        authMode: McpAuthMode
        credentialSecretId: string | null
        allowedTools: JsonValue
        status: ConnectionStatus
        validationMessage: string | null
        lastValidatedAt: Date | null
        createdByUserId: string | null
    }): Promise<AppMcpConnectionRecord> {
        const rows = await sql`
            INSERT INTO app_mcp_connections (
                id,
                name,
                server_key,
                transport,
                command,
                args,
                url,
                headers,
                auth_mode,
                credential_secret_id,
                allowed_tools,
                status,
                validation_message,
                last_validated_at,
                created_by_user_id,
                created_at,
                updated_at
            )
            VALUES (
                ${input.id},
                ${input.name},
                ${input.serverKey},
                ${input.transport},
                ${input.command},
                ${sql.json(input.args)},
                ${input.url},
                ${sql.json(input.headers)},
                ${input.authMode},
                ${input.credentialSecretId},
                ${sql.json(input.allowedTools)},
                ${input.status},
                ${input.validationMessage},
                ${input.lastValidatedAt},
                ${input.createdByUserId},
                now(),
                now()
            )
            ON CONFLICT (id)
            DO UPDATE SET
                name = excluded.name,
                server_key = excluded.server_key,
                transport = excluded.transport,
                command = excluded.command,
                args = excluded.args,
                url = excluded.url,
                headers = excluded.headers,
                auth_mode = excluded.auth_mode,
                credential_secret_id = excluded.credential_secret_id,
                allowed_tools = excluded.allowed_tools,
                status = excluded.status,
                validation_message = excluded.validation_message,
                last_validated_at = excluded.last_validated_at,
                updated_at = now()
            RETURNING *
        `
        return mapAppMcpConnection(rows[0] as Record<string, unknown>)
    },
}

export const appSettingsRepository = {
    async getOrCreate(): Promise<AppSettingsRecord> {
        const rows = await sql`
            INSERT INTO app_settings (id)
            VALUES (true)
            ON CONFLICT (id) DO UPDATE SET updated_at = app_settings.updated_at
            RETURNING *
        `
        return mapAppSettings(rows[0] as Record<string, unknown>)
    },

    async update(input: {
        defaultProviderConnectionId: string | null
        defaultModel: string | null
        onboardingCompletedAt: Date | null
        capabilityDefaults?: JsonValue
        searchConfig?: JsonValue
        imageConfig?: JsonValue
    }): Promise<AppSettingsRecord> {
        const rows = await sql`
            UPDATE app_settings
            SET
                default_provider_connection_id = ${input.defaultProviderConnectionId},
                default_model = ${input.defaultModel},
                capability_defaults = COALESCE(${input.capabilityDefaults === undefined ? null : sql.json(input.capabilityDefaults)}::jsonb, capability_defaults),
                search_config = COALESCE(${input.searchConfig === undefined ? null : sql.json(input.searchConfig)}::jsonb, search_config),
                image_config = COALESCE(${input.imageConfig === undefined ? null : sql.json(input.imageConfig)}::jsonb, image_config),
                onboarding_completed_at = ${input.onboardingCompletedAt},
                updated_at = now()
            WHERE id = true
            RETURNING *
        `
        return mapAppSettings(rows[0] as Record<string, unknown>)
    },
}

export const roomConfigRepository = {
    async getOrCreate(roomId: string): Promise<RoomConfigRecord> {
        const rows = await sql`
            INSERT INTO room_configs (room_id)
            VALUES (${roomId})
            ON CONFLICT (room_id) DO UPDATE SET updated_at = room_configs.updated_at
            RETURNING *
        `
        return mapRoomConfig(rows[0] as Record<string, unknown>)
    },

    async findByRoomId(roomId: string): Promise<RoomConfigRecord | null> {
        const rows = await sql`
            SELECT *
            FROM room_configs
            WHERE room_id = ${roomId}
            LIMIT 1
        `
        if (rows.length === 0) {
            return null
        }
        return mapRoomConfig(rows[0] as Record<string, unknown>)
    },

    async upsert(input: {
        roomId: string
        instructions: string
        providerMode: RoomProviderMode
        providerConnectionId: string | null
        roomMode: string
        capabilityOverrides: JsonValue
        imageProvider: string | null
        imageModel: string | null
        imageSecretId: string | null
        cronTimezone: string
        browserActionBudget: number
    }): Promise<RoomConfigRecord> {
        const rows = await sql`
            INSERT INTO room_configs (
                room_id,
                instructions,
                provider_mode,
                provider_connection_id,
                room_mode,
                capability_overrides,
                image_provider,
                image_model,
                image_secret_id,
                cron_timezone,
                browser_action_budget,
                created_at,
                updated_at
            )
            VALUES (
                ${input.roomId},
                ${input.instructions},
                ${input.providerMode},
                ${input.providerConnectionId},
                ${input.roomMode},
                ${sql.json(input.capabilityOverrides)},
                ${input.imageProvider},
                ${input.imageModel},
                ${input.imageSecretId},
                ${input.cronTimezone},
                ${input.browserActionBudget},
                now(),
                now()
            )
            ON CONFLICT (room_id)
            DO UPDATE SET
                instructions = excluded.instructions,
                provider_mode = excluded.provider_mode,
                provider_connection_id = excluded.provider_connection_id,
                room_mode = excluded.room_mode,
                capability_overrides = excluded.capability_overrides,
                image_provider = excluded.image_provider,
                image_model = excluded.image_model,
                image_secret_id = excluded.image_secret_id,
                cron_timezone = excluded.cron_timezone,
                browser_action_budget = excluded.browser_action_budget,
                updated_at = now()
            RETURNING *
        `
        return mapRoomConfig(rows[0] as Record<string, unknown>)
    },
}

export const roomMcpBindingRepository = {
    async listByRoomId(roomId: string): Promise<RoomMcpBindingRecord[]> {
        const rows = await sql`
            SELECT *
            FROM room_mcp_bindings
            WHERE room_id = ${roomId}
            ORDER BY created_at ASC
        `
        return rows.map((row) => mapRoomMcpBinding(row as Record<string, unknown>))
    },

    async replaceForRoom(
        roomId: string,
        bindings: Array<{
            mcpConnectionId: string
            allowedTools: JsonValue
            enabled: boolean
        }>,
    ): Promise<RoomMcpBindingRecord[]> {
        return withTransaction(async (trx) => {
            await trx`
                DELETE FROM room_mcp_bindings
                WHERE room_id = ${roomId}
            `

            const rows: RoomMcpBindingRecord[] = []
            for (const binding of bindings) {
                const inserted = await trx`
                    INSERT INTO room_mcp_bindings (
                        room_id,
                        mcp_connection_id,
                        allowed_tools,
                        enabled,
                        created_at,
                        updated_at
                    )
                    VALUES (
                        ${roomId},
                        ${binding.mcpConnectionId},
                        ${sql.json(binding.allowedTools)},
                        ${binding.enabled},
                        now(),
                        now()
                    )
                    RETURNING *
                `
                rows.push(mapRoomMcpBinding(inserted[0] as Record<string, unknown>))
            }
            return rows
        })
    },
}

export const roomConfigRepository_delete = {
    async deleteByRoomId(roomId: string): Promise<void> {
        await sql`DELETE FROM room_configs WHERE room_id = ${roomId}`
    },
}

export const roomMcpBindingRepository_delete = {
    async deleteByRoomId(roomId: string): Promise<void> {
        await sql`DELETE FROM room_mcp_bindings WHERE room_id = ${roomId}`
    },
}

export const roomSecretRepository = {
    async listByRoomId(roomId: string): Promise<RoomSecretRecord[]> {
        const rows = await sql`
            SELECT *
            FROM room_secrets
            WHERE room_id = ${roomId}
            ORDER BY updated_at DESC
        `
        return rows.map((row) => mapRoomSecret(row as Record<string, unknown>))
    },

    async deleteByRoomId(roomId: string): Promise<void> {
        await sql`DELETE FROM room_secrets WHERE room_id = ${roomId}`
    },

    async upsert(input: {
        roomId: string
        secretId: string
        label: string
        envKey: string
        purpose: RoomSecretPurpose
        provider: string | null
        createdByUserId: string | null
    }): Promise<RoomSecretRecord> {
        const rows = await sql`
            INSERT INTO room_secrets (
                room_id,
                secret_id,
                label,
                env_key,
                purpose,
                provider,
                created_by_user_id,
                created_at,
                updated_at
            )
            VALUES (
                ${input.roomId},
                ${input.secretId},
                ${input.label},
                ${input.envKey},
                ${input.purpose},
                ${input.provider},
                ${input.createdByUserId},
                now(),
                now()
            )
            ON CONFLICT (room_id, env_key)
            DO UPDATE SET
                secret_id = excluded.secret_id,
                label = excluded.label,
                purpose = excluded.purpose,
                provider = excluded.provider,
                updated_at = now()
            RETURNING *
        `
        return mapRoomSecret(rows[0] as Record<string, unknown>)
    },
}
