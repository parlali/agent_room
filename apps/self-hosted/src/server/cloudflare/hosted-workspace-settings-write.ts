import type { JsonValue } from '#/domain/domain-types'
import type { AgentRoomHostedEnv } from './bindings'
import { getHostedWorkspaceSettings } from './hosted-operator-config-service'
import { nowIso, stringifyJson } from './hosted-json'

export async function updateHostedWorkspaceSettings(
    env: AgentRoomHostedEnv,
    workspaceId: string,
    patch: Partial<{
        defaultProviderConnectionId: string | null
        defaultModel: string | null
        capabilityDefaults: JsonValue
        searchConfig: JsonValue
        imageConfig: JsonValue
        onboardingCompletedAt: Date | null
    }>,
): Promise<void> {
    const current = await getHostedWorkspaceSettings({ env, workspaceId })
    const now = nowIso()
    await env.AGENT_ROOM_DB.prepare(
        `
            UPDATE hosted_workspace_settings
            SET default_provider_connection_id = ?1,
                default_model = ?2,
                capability_defaults = ?3,
                search_config = ?4,
                image_config = ?5,
                onboarding_completed_at = ?6,
                updated_at = ?7
            WHERE workspace_id = ?8
        `,
    )
        .bind(
            patch.defaultProviderConnectionId !== undefined
                ? patch.defaultProviderConnectionId
                : current.defaultProviderConnectionId,
            patch.defaultModel !== undefined ? patch.defaultModel : current.defaultModel,
            stringifyJson(patch.capabilityDefaults ?? current.capabilityDefaults),
            stringifyJson(patch.searchConfig ?? current.searchConfig),
            stringifyJson(patch.imageConfig ?? current.imageConfig),
            patch.onboardingCompletedAt !== undefined
                ? (patch.onboardingCompletedAt?.toISOString() ?? null)
                : (current.onboardingCompletedAt?.toISOString() ?? null),
            now,
            workspaceId,
        )
        .run()
}
