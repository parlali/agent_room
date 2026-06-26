import { hostedPlanAllowsManagedOpenRouter } from '@agent-room/billing'
import type { HostedBillingPlanStatus } from './hosted-billing-types'
import { isHostedBillingPlanStatusActive } from './hosted-billing-types'

export const hostedManagedModelProvider = 'openrouter' as const
export const hostedManagedModelId = 'z-ai/glm-5.2'
export const hostedManagedModelLabel = 'Hosted'
export const hostedManagedModelPolicyId = 'managed-hosted-model-v1'
export const hostedManagedModelRequestReservationCents = 500
export const hostedManagedModelMaxOutputTokens = 16384
export const hostedModelSourceLabels = ['Hosted', 'OpenRouter', 'Codex'] as const

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
