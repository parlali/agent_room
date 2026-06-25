import type { AgentRoomHostedEnv } from './bindings'
import { resolveHostedConfig } from './hosted-config'
import { readHostedBillingAccount } from './hosted-billing-repository'
import { countActiveHostedRuntimesForWorkspace } from './hosted-runtime-state-repository'
import { isHostedBillingPlanStatusActive } from './hosted-billing-types'

export interface HostedRuntimeAccessInput {
    env: AgentRoomHostedEnv
    workspaceId: string
    roomId: string
}

export type HostedRuntimeAccessDecision =
    | { allowed: true }
    | { allowed: false; reason: 'no_subscription' | 'room_limit' }

type HostedRuntimeAccessDeniedReason = Extract<
    HostedRuntimeAccessDecision,
    { allowed: false }
>['reason']

export function hostedRuntimeAccessDeniedMessage(reason: HostedRuntimeAccessDeniedReason): string {
    return reason === 'no_subscription'
        ? 'Hosted runtime access denied: workspace has no active subscription'
        : 'Hosted runtime access denied: workspace concurrent room limit reached'
}

export async function evaluateHostedRuntimeAccess(
    input: HostedRuntimeAccessInput,
): Promise<HostedRuntimeAccessDecision> {
    const config = resolveHostedConfig(input.env)
    const account = await readHostedBillingAccount({
        env: input.env,
        workspaceId: input.workspaceId,
    })
    if (!isHostedBillingPlanStatusActive(account.planStatus)) {
        return { allowed: false, reason: 'no_subscription' }
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
