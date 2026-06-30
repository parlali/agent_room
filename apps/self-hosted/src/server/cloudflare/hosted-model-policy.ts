import { hostedPlanAllowsManagedOpenRouter } from '@agent-room/billing'
import type { AgentRoomHostedEnv } from './bindings'
import { readHostedBillingAccount } from './hosted-billing-repository'
import type { HostedBillingAccountSnapshot, HostedBillingPlanStatus } from './hosted-billing-types'
import { isHostedBillingPlanStatusActive } from './hosted-billing-types'
import { resolveHostedConfig } from './hosted-config'

export const hostedManagedModelProvider = 'openrouter' as const
export const hostedManagedModelId = 'moonshotai/kimi-k2.7-code'
export const hostedManagedModelLabel = 'Hosted'
export const hostedManagedModelInputModalities: Array<'text' | 'image'> = ['text', 'image']
export const hostedManagedModelPolicyId = 'managed-hosted-model-v1'
export const hostedManagedModelRequestReservationCents = 500
export const hostedManagedModelContextWindowTokens = 128000

export const hostedManagedModelPreflightSpendEstimateCents = 50

export const hostedManagedModelReasoningEffort = 'low' as const

export const hostedManagedModelInputCostMicrosPerMillionTokens = 740000
export const hostedManagedModelOutputCostMicrosPerMillionTokens = 3500000

export function estimateHostedManagedModelCostMicros(input: {
    inputTokens: number | null
    cachedTokens: number | null
    outputTokens: number | null
    reasoningTokens: number | null
}): number | null {
    const inputTokens = Math.max(0, input.inputTokens ?? 0)
    const cachedTokens = Math.max(0, input.cachedTokens ?? 0)
    const outputTokens = Math.max(0, input.outputTokens ?? 0)
    const reasoningTokens = Math.max(0, input.reasoningTokens ?? 0)
    if (inputTokens + cachedTokens + outputTokens + reasoningTokens === 0) {
        return null
    }
    const promptTokens = inputTokens + cachedTokens
    const completionTokens = outputTokens + reasoningTokens
    const micros =
        (promptTokens * hostedManagedModelInputCostMicrosPerMillionTokens +
            completionTokens * hostedManagedModelOutputCostMicrosPerMillionTokens) /
        1_000_000
    return Math.ceil(micros)
}
export const hostedManagedModelMaxOutputTokens = 16384
export const hostedManagedModelCompactionReserveTokens = 16384
export const hostedManagedModelCompactionKeepRecentTokens = 20000
export const hostedManagedModelRetryMaxRetries = 0
export const hostedManagedModelRetryMaxRetryDelayMs = 0
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
        contextWindowTokens: hostedManagedModelContextWindowTokens,
        maxOutputTokens: hostedManagedModelMaxOutputTokens,
        compactionReserveTokens: hostedManagedModelCompactionReserveTokens,
        compactionKeepRecentTokens: hostedManagedModelCompactionKeepRecentTokens,
        retryEnabled: false,
        maxProviderRetries: hostedManagedModelRetryMaxRetries,
        maxProviderRetryDelayMs: hostedManagedModelRetryMaxRetryDelayMs,
    }
}
