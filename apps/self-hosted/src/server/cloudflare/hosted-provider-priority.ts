import type { AgentRoomHostedEnv } from './bindings'
import { ensureHostedBillingAccount, readHostedBillingAccount } from './hosted-billing-repository'
import { resolveHostedConfig } from './hosted-config'

export type HostedProviderCandidate = 'codex' | 'user_key' | 'hosted_openrouter'

export interface HostedProviderPriorityInput {
    env: AgentRoomHostedEnv
    workspaceId: string
    codexAvailable: boolean
    userKeyAvailable: boolean
}

export async function selectHostedProviderCandidate(
    input: HostedProviderPriorityInput,
): Promise<HostedProviderCandidate | null> {
    if (input.codexAvailable) return 'codex'
    if (input.userKeyAvailable) return 'user_key'

    const config = resolveHostedConfig(input.env)
    if (!config.hostedProviders.openrouter) return null
    await ensureHostedBillingAccount({
        env: input.env,
        workspaceId: input.workspaceId,
    })
    const account = await readHostedBillingAccount({
        env: input.env,
        workspaceId: input.workspaceId,
    })
    const total = account.includedBalanceCents + account.purchasedBalanceCents
    return total > 0 ? 'hosted_openrouter' : null
}
