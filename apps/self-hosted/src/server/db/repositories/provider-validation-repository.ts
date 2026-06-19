import type { ConnectionStatus, ProviderApi, ProviderAuthMode } from '#/domain/domain-types'
import { providerValidationAttempts } from '../schema'
import { createDatabaseId, repositoryDatabase } from './repository-utils'

export const providerValidationRepository = {
    async appendAttempt(input: {
        providerConnectionId: string | null
        roomId: string | null
        provider: string
        authMode: ProviderAuthMode
        api: ProviderApi
        baseUrl: string | null
        model: string
        status: ConnectionStatus
        message: string
        startedAt: Date
        completedAt: Date
    }): Promise<void> {
        const db = await repositoryDatabase()
        await db.insert(providerValidationAttempts).values({
            id: createDatabaseId(),
            providerConnectionId: input.providerConnectionId,
            roomId: input.roomId,
            provider: input.provider,
            authMode: input.authMode,
            api: input.api,
            baseUrl: input.baseUrl,
            model: input.model,
            status: input.status,
            message: input.message,
            startedAt: input.startedAt,
            completedAt: input.completedAt,
        })
    },
}
