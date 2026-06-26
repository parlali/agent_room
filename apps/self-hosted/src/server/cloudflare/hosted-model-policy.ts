import { hostedPlanAllowsManagedOpenRouter } from '@agent-room/billing'
import type { AgentRoomHostedEnv } from './bindings'
import { readHostedBillingAccount } from './hosted-billing-repository'
import type { HostedBillingAccountSnapshot, HostedBillingPlanStatus } from './hosted-billing-types'
import { isHostedBillingPlanStatusActive } from './hosted-billing-types'
import { resolveHostedConfig } from './hosted-config'

export const hostedManagedModelProvider = 'openrouter' as const
export const hostedManagedModelId = 'z-ai/glm-5.2'
export const hostedManagedModelLabel = 'Hosted'
export const hostedManagedModelPolicyId = 'managed-hosted-model-v1'
export const hostedManagedModelRequestReservationCents = 500
export const hostedManagedModelMaxOutputTokens = 16384
export const hostedModelSourceLabels = ['Hosted', 'OpenRouter', 'Codex'] as const
export const hostedManagedModelUnavailableMessage =
    'Hosted model access is not available for this workspace'

export function hostedManagedModelAvailable(input: {
    openRouterApiKey: string | null | undefined
    hostedModelsDisabled?: boolean
    planKey: string | null | undefined
    planStatus: HostedBillingPlanStatus | null | undefined
}): boolean {
    return Boolean(
        input.openRouterApiKey?.trim() &&
        !input.hostedModelsDisabled &&
        isHostedBillingPlanStatusActive(input.planStatus ?? 'none') &&
        hostedPlanAllowsManagedOpenRouter(input.planKey),
    )
}

export async function resolveHostedManagedModelAvailable(input: {
    env: AgentRoomHostedEnv
    workspaceId: string
    billingAccount?: HostedBillingAccountSnapshot | null
}): Promise<boolean> {
    const hostedConfig = resolveHostedConfig(input.env)
    const billingAccount =
        input.billingAccount === undefined
            ? await readHostedBillingAccount({
                  env: input.env,
                  workspaceId: input.workspaceId,
              })
            : input.billingAccount
    return hostedManagedModelAvailable({
        openRouterApiKey: hostedConfig.managedProviders.openRouterApiKey,
        hostedModelsDisabled: hostedConfig.killSwitches.hostedModels,
        planKey: billingAccount?.planKey,
        planStatus: billingAccount?.planStatus,
    })
}

export async function assertHostedManagedModelAvailable(input: {
    env: AgentRoomHostedEnv
    workspaceId: string
}): Promise<void> {
    const available = await resolveHostedManagedModelAvailable(input)
    if (!available) {
        throw new Error(hostedManagedModelUnavailableMessage)
    }
}

export function hostedManagedModelAuditMetadata(input: {
    reservationCents: number
}): Record<string, unknown> {
    return {
        modelSource: 'managed_hosted',
        providerCandidate: 'hosted_openrouter',
        provider: hostedManagedModelProvider,
        model: hostedManagedModelId,
        hostedModelPolicyId: hostedManagedModelPolicyId,
        reservationCeilingCents: input.reservationCents,
        maxOutputTokens: hostedManagedModelMaxOutputTokens,
    }
}
