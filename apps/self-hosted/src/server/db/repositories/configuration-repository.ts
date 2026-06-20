import { and, asc, count, desc, eq, isNull, notExists } from 'drizzle-orm'
import type {
    AppMcpConnectionRecord,
    AppProviderConnectionRecord,
    AppSettingsRecord,
    ConnectionStatus,
    JsonValue,
    McpAuthMode,
    McpTransport,
    ProviderApi,
    ProviderAuthMode,
    RoomConfigRecord,
    RoomMcpBindingRecord,
    RoomProviderMode,
    RoomSecretPurpose,
    RoomSecretRecord,
} from '#/domain/domain-types'
import type { DatabaseBatchStatements } from '../client'
import {
    appMcpConnections,
    appProviderConnections,
    appSettings,
    roomConfigs,
    roomMcpBindings,
    roomSecrets,
} from '../schema'
import {
    mapAppMcpConnection,
    mapAppProviderConnection,
    mapAppSettings,
    mapRoomConfig,
    mapRoomMcpBinding,
    mapRoomSecret,
} from './row-mappers'
import {
    createDatabaseId,
    excluded,
    nowDate,
    repositoryBatch,
    repositoryDatabase,
} from './repository-utils'

export const appProviderConnectionRepository = {
    async list(): Promise<AppProviderConnectionRecord[]> {
        const db = await repositoryDatabase()
        const rows = await db
            .select()
            .from(appProviderConnections)
            .orderBy(desc(appProviderConnections.updatedAt))
        return rows.map(mapAppProviderConnection)
    },

    async findById(id: string): Promise<AppProviderConnectionRecord | null> {
        const db = await repositoryDatabase()
        const [row] = await db
            .select()
            .from(appProviderConnections)
            .where(eq(appProviderConnections.id, id))
            .limit(1)
        return row ? mapAppProviderConnection(row) : null
    },

    async findByProvider(provider: string): Promise<AppProviderConnectionRecord | null> {
        const db = await repositoryDatabase()
        const [row] = await db
            .select()
            .from(appProviderConnections)
            .where(eq(appProviderConnections.provider, provider as never))
            .orderBy(desc(appProviderConnections.updatedAt))
            .limit(1)
        return row ? mapAppProviderConnection(row) : null
    },

    async countRoomReferences(id: string): Promise<number> {
        const db = await repositoryDatabase()
        const [row] = await db
            .select({ count: count() })
            .from(roomConfigs)
            .where(eq(roomConfigs.providerConnectionId, id))
        return row?.count ?? 0
    },

    async deleteByIdIfUnused(id: string): Promise<boolean> {
        const db = await repositoryDatabase()
        const [deletedRows] = await repositoryBatch([
            db
                .delete(appProviderConnections)
                .where(
                    and(
                        eq(appProviderConnections.id, id),
                        notExists(
                            db
                                .select({ roomId: roomConfigs.roomId })
                                .from(roomConfigs)
                                .where(eq(roomConfigs.providerConnectionId, id)),
                        ),
                    ),
                )
                .returning({ id: appProviderConnections.id }),
            db
                .update(appSettings)
                .set({
                    defaultModel: null,
                    updatedAt: nowDate(),
                })
                .where(isNull(appSettings.defaultProviderConnectionId)),
        ])
        return (deletedRows as Array<{ id: string }>).length > 0
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
        const db = await repositoryDatabase()
        const now = nowDate()
        const [row] = await db
            .insert(appProviderConnections)
            .values({
                id: input.id,
                label: input.label,
                provider: input.provider as never,
                authMode: input.authMode,
                api: input.api,
                baseUrl: input.baseUrl,
                defaultModel: input.defaultModel,
                fallbackModels: input.fallbackModels,
                credentialSecretId: input.credentialSecretId,
                status: input.status,
                validationMessage: input.validationMessage,
                lastValidatedAt: input.lastValidatedAt,
                createdByUserId: input.createdByUserId,
                createdAt: now,
                updatedAt: now,
            })
            .onConflictDoUpdate({
                target: appProviderConnections.id,
                set: {
                    label: excluded('label'),
                    provider: excluded('provider'),
                    authMode: excluded('auth_mode'),
                    api: excluded('api'),
                    baseUrl: excluded('base_url'),
                    defaultModel: excluded('default_model'),
                    fallbackModels: excluded('fallback_models'),
                    credentialSecretId: excluded('credential_secret_id'),
                    status: excluded('status'),
                    validationMessage: excluded('validation_message'),
                    lastValidatedAt: excluded('last_validated_at'),
                    updatedAt: now,
                },
            })
            .returning()
        return mapAppProviderConnection(row)
    },

    async updateValidation(input: {
        id: string
        status: ConnectionStatus
        validationMessage: string | null
        lastValidatedAt: Date
    }): Promise<AppProviderConnectionRecord> {
        const db = await repositoryDatabase()
        const [row] = await db
            .update(appProviderConnections)
            .set({
                status: input.status,
                validationMessage: input.validationMessage,
                lastValidatedAt: input.lastValidatedAt,
                updatedAt: nowDate(),
            })
            .where(eq(appProviderConnections.id, input.id))
            .returning()
        if (!row) {
            throw new Error('Provider connection does not exist')
        }
        return mapAppProviderConnection(row)
    },
}

export const appMcpConnectionRepository = {
    async list(): Promise<AppMcpConnectionRecord[]> {
        const db = await repositoryDatabase()
        const rows = await db
            .select()
            .from(appMcpConnections)
            .orderBy(desc(appMcpConnections.updatedAt))
        return rows.map(mapAppMcpConnection)
    },

    async findById(id: string): Promise<AppMcpConnectionRecord | null> {
        const db = await repositoryDatabase()
        const [row] = await db
            .select()
            .from(appMcpConnections)
            .where(eq(appMcpConnections.id, id))
            .limit(1)
        return row ? mapAppMcpConnection(row) : null
    },

    async countRoomBindings(id: string): Promise<number> {
        const db = await repositoryDatabase()
        const [row] = await db
            .select({ count: count() })
            .from(roomMcpBindings)
            .where(eq(roomMcpBindings.mcpConnectionId, id))
        return row?.count ?? 0
    },

    async deleteByIdIfUnused(id: string): Promise<boolean> {
        const db = await repositoryDatabase()
        const rows = await db
            .delete(appMcpConnections)
            .where(
                and(
                    eq(appMcpConnections.id, id),
                    notExists(
                        db
                            .select({ roomId: roomMcpBindings.roomId })
                            .from(roomMcpBindings)
                            .where(eq(roomMcpBindings.mcpConnectionId, id)),
                    ),
                ),
            )
            .returning({ id: appMcpConnections.id })
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
        const db = await repositoryDatabase()
        const now = nowDate()
        const [row] = await db
            .insert(appMcpConnections)
            .values({
                id: input.id,
                name: input.name,
                serverKey: input.serverKey,
                transport: input.transport,
                command: input.command,
                args: input.args,
                url: input.url,
                headers: input.headers,
                authMode: input.authMode,
                credentialSecretId: input.credentialSecretId,
                allowedTools: input.allowedTools,
                status: input.status,
                validationMessage: input.validationMessage,
                lastValidatedAt: input.lastValidatedAt,
                createdByUserId: input.createdByUserId,
                createdAt: now,
                updatedAt: now,
            })
            .onConflictDoUpdate({
                target: appMcpConnections.id,
                set: {
                    name: excluded('name'),
                    serverKey: excluded('server_key'),
                    transport: excluded('transport'),
                    command: excluded('command'),
                    args: excluded('args'),
                    url: excluded('url'),
                    headers: excluded('headers'),
                    authMode: excluded('auth_mode'),
                    credentialSecretId: excluded('credential_secret_id'),
                    allowedTools: excluded('allowed_tools'),
                    status: excluded('status'),
                    validationMessage: excluded('validation_message'),
                    lastValidatedAt: excluded('last_validated_at'),
                    updatedAt: now,
                },
            })
            .returning()
        return mapAppMcpConnection(row)
    },
}

export const appSettingsRepository = {
    async getOrCreate(): Promise<AppSettingsRecord> {
        const db = await repositoryDatabase()
        const now = nowDate()
        const [created] = await db
            .insert(appSettings)
            .values({
                id: true,
                createdAt: now,
                updatedAt: now,
            })
            .onConflictDoNothing()
            .returning()
        if (created) {
            return mapAppSettings(created)
        }
        const [existing] = await db
            .select()
            .from(appSettings)
            .where(eq(appSettings.id, true))
            .limit(1)
        if (!existing) {
            throw new Error('App settings row missing')
        }
        return mapAppSettings(existing)
    },

    async update(input: {
        defaultProviderConnectionId: string | null
        defaultModel: string | null
        onboardingCompletedAt: Date | null
        capabilityDefaults?: JsonValue
        searchConfig?: JsonValue
        imageConfig?: JsonValue
    }): Promise<AppSettingsRecord> {
        const values: Partial<typeof appSettings.$inferInsert> = {
            defaultProviderConnectionId: input.defaultProviderConnectionId,
            defaultModel: input.defaultModel,
            onboardingCompletedAt: input.onboardingCompletedAt,
            updatedAt: nowDate(),
        }
        if (input.capabilityDefaults !== undefined) {
            values.capabilityDefaults = input.capabilityDefaults
        }
        if (input.searchConfig !== undefined) {
            values.searchConfig = input.searchConfig
        }
        if (input.imageConfig !== undefined) {
            values.imageConfig = input.imageConfig
        }

        const db = await repositoryDatabase()
        const [row] = await db
            .update(appSettings)
            .set(values)
            .where(eq(appSettings.id, true))
            .returning()
        if (!row) {
            throw new Error('App settings row missing')
        }
        return mapAppSettings(row)
    },
}

export const roomConfigRepository = {
    async getOrCreate(roomId: string): Promise<RoomConfigRecord> {
        const db = await repositoryDatabase()
        const now = nowDate()
        const [created] = await db
            .insert(roomConfigs)
            .values({
                roomId,
                createdAt: now,
                updatedAt: now,
            })
            .onConflictDoNothing()
            .returning()
        if (created) {
            return mapRoomConfig(created)
        }
        const existing = await this.findByRoomId(roomId)
        if (!existing) {
            throw new Error(`Room config row missing for ${roomId}`)
        }
        return existing
    },

    async findByRoomId(roomId: string): Promise<RoomConfigRecord | null> {
        const db = await repositoryDatabase()
        const [row] = await db
            .select()
            .from(roomConfigs)
            .where(eq(roomConfigs.roomId, roomId))
            .limit(1)
        return row ? mapRoomConfig(row) : null
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
        const db = await repositoryDatabase()
        const now = nowDate()
        const [row] = await db
            .insert(roomConfigs)
            .values({
                roomId: input.roomId,
                instructions: input.instructions,
                providerMode: input.providerMode,
                providerConnectionId: input.providerConnectionId,
                roomMode: input.roomMode as never,
                capabilityOverrides: input.capabilityOverrides,
                imageProvider: input.imageProvider as never,
                imageModel: input.imageModel,
                imageSecretId: input.imageSecretId,
                cronTimezone: input.cronTimezone,
                browserActionBudget: input.browserActionBudget,
                createdAt: now,
                updatedAt: now,
            })
            .onConflictDoUpdate({
                target: roomConfigs.roomId,
                set: {
                    instructions: excluded('instructions'),
                    providerMode: excluded('provider_mode'),
                    providerConnectionId: excluded('provider_connection_id'),
                    roomMode: excluded('room_mode'),
                    capabilityOverrides: excluded('capability_overrides'),
                    imageProvider: excluded('image_provider'),
                    imageModel: excluded('image_model'),
                    imageSecretId: excluded('image_secret_id'),
                    cronTimezone: excluded('cron_timezone'),
                    browserActionBudget: excluded('browser_action_budget'),
                    updatedAt: now,
                },
            })
            .returning()
        return mapRoomConfig(row)
    },
}

export const roomMcpBindingRepository = {
    async listByRoomId(roomId: string): Promise<RoomMcpBindingRecord[]> {
        const db = await repositoryDatabase()
        const rows = await db
            .select()
            .from(roomMcpBindings)
            .where(eq(roomMcpBindings.roomId, roomId))
            .orderBy(asc(roomMcpBindings.createdAt))
        return rows.map(mapRoomMcpBinding)
    },

    async replaceForRoom(
        roomId: string,
        bindings: Array<{
            mcpConnectionId: string
            allowedTools: JsonValue
            enabled: boolean
        }>,
    ): Promise<RoomMcpBindingRecord[]> {
        const db = await repositoryDatabase()
        const now = nowDate()
        const statements: DatabaseBatchStatements = [
            db.delete(roomMcpBindings).where(eq(roomMcpBindings.roomId, roomId)),
            ...bindings.map((binding) =>
                db
                    .insert(roomMcpBindings)
                    .values({
                        roomId,
                        mcpConnectionId: binding.mcpConnectionId,
                        allowedTools: binding.allowedTools,
                        enabled: binding.enabled,
                        createdAt: now,
                        updatedAt: now,
                    })
                    .returning(),
            ),
        ]
        const results = await repositoryBatch(statements)
        return results
            .slice(1)
            .flatMap((result) => result as Array<typeof roomMcpBindings.$inferSelect>)
            .map(mapRoomMcpBinding)
    },
}

export const roomConfigRepository_delete = {
    async deleteByRoomId(roomId: string): Promise<void> {
        const db = await repositoryDatabase()
        await db.delete(roomConfigs).where(eq(roomConfigs.roomId, roomId))
    },
}

export const roomMcpBindingRepository_delete = {
    async deleteByRoomId(roomId: string): Promise<void> {
        const db = await repositoryDatabase()
        await db.delete(roomMcpBindings).where(eq(roomMcpBindings.roomId, roomId))
    },
}

export const roomSecretRepository = {
    async listByRoomId(roomId: string): Promise<RoomSecretRecord[]> {
        const db = await repositoryDatabase()
        const rows = await db
            .select()
            .from(roomSecrets)
            .where(eq(roomSecrets.roomId, roomId))
            .orderBy(desc(roomSecrets.updatedAt))
        return rows.map(mapRoomSecret)
    },

    async deleteByRoomId(roomId: string): Promise<void> {
        const db = await repositoryDatabase()
        await db.delete(roomSecrets).where(eq(roomSecrets.roomId, roomId))
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
        const db = await repositoryDatabase()
        const now = nowDate()
        const [row] = await db
            .insert(roomSecrets)
            .values({
                id: createDatabaseId(),
                roomId: input.roomId,
                secretId: input.secretId,
                label: input.label,
                envKey: input.envKey,
                purpose: input.purpose,
                provider: input.provider,
                createdByUserId: input.createdByUserId,
                createdAt: now,
                updatedAt: now,
            })
            .onConflictDoUpdate({
                target: [roomSecrets.roomId, roomSecrets.envKey],
                set: {
                    secretId: excluded('secret_id'),
                    label: excluded('label'),
                    purpose: excluded('purpose'),
                    provider: excluded('provider'),
                    updatedAt: now,
                },
            })
            .returning()
        return mapRoomSecret(row)
    },
}
