import type { AgentRoomHostedEnv } from './bindings'
import { resolveHostedConfig } from './hosted-config'
import { readHostedBillingAccount } from './hosted-billing-repository'
import { countActiveHostedRuntimesForWorkspace } from './hosted-runtime-state-repository'

export interface HostedRuntimeAccessInput {
    env: AgentRoomHostedEnv
    workspaceId: string
    roomId: string
    codexAvailable: boolean
    userKeyAvailable: boolean
}

export type HostedRuntimeAccessDecision =
    | { allowed: true }
    | { allowed: false; reason: 'no_subscription' | 'room_limit' }

export async function evaluateHostedRuntimeAccess(
    input: HostedRuntimeAccessInput,
): Promise<HostedRuntimeAccessDecision> {
    const config = resolveHostedConfig(input.env)
    if (config.billing.mode !== 'stripe') {
        return { allowed: true }
    }

    const byok = input.codexAvailable || input.userKeyAvailable
    if (!byok) {
        const account = await readHostedBillingAccount({
            env: input.env,
            workspaceId: input.workspaceId,
        })
        const subscriptionActive =
            account.planStatus === 'active' || account.planStatus === 'trialing'
        if (!subscriptionActive) {
            return { allowed: false, reason: 'no_subscription' }
        }
    }

    const activeRuntimes = await countActiveHostedRuntimesForWorkspace({
        env: input.env,
        workspaceId: input.workspaceId,
        excludeRoomId: input.roomId,
    })
    if (activeRuntimes >= config.billing.maxConcurrentRoomsPerWorkspace) {
        return { allowed: false, reason: 'room_limit' }
    }

    return { allowed: true }
}
