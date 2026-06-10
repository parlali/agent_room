import type { ConnectionStatus, ProviderApi, ProviderAuthMode } from '#/domain/domain-types'
import { sql } from '../client'

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
        await sql`
            INSERT INTO provider_validation_attempts (
                provider_connection_id,
                room_id,
                provider,
                auth_mode,
                api,
                base_url,
                model,
                status,
                message,
                started_at,
                completed_at
            )
            VALUES (
                ${input.providerConnectionId},
                ${input.roomId},
                ${input.provider},
                ${input.authMode},
                ${input.api},
                ${input.baseUrl},
                ${input.model},
                ${input.status},
                ${input.message},
                ${input.startedAt},
                ${input.completedAt}
            )
        `
    },
}
