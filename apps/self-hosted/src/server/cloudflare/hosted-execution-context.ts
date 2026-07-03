import type { AgentRoomHostedEnv } from './bindings'
import { assertHostedQuotaAllowed, readHostedQuotaPolicy } from './hosted-abuse-controls'
import type { HostedProviderCandidate } from './hosted-provider-priority'
import { requireHostedRequestContext } from './hosted-request-context'
import { readHostedContextActor } from './hosted-route-auth'
import { getHostedRuntimeState } from './hosted-room-service'
import { assertHostedProviderCreditsAvailable } from './hosted-usage-billing'

export async function requireHostedExecutionContext() {
    const context = requireHostedRequestContext()
    const actor = await readHostedContextActor(context)
    if (!actor) {
        throw new Error('Authentication required')
    }
    return {
        context,
        actor,
    }
}

export async function assertHostedRunAllowed(input: {
    env: AgentRoomHostedEnv
    workspaceId: string
    roomId: string
    actorUserId?: string | null
    request?: Request | null
    sessionKey?: string | null
    runId?: string | null
    jobId?: string | null
    resolvedProviderCandidate?: HostedProviderCandidate | null
}): Promise<void> {
    const providerCandidate =
        input.resolvedProviderCandidate !== undefined
            ? input.resolvedProviderCandidate
            : ((await getHostedRuntimeState(input))?.row.providerCandidate ?? null)
    if (!providerCandidate) {
        throw new Error('Hosted runtime provider binding is missing')
    }
    const quotaCheck = {
        env: input.env,
        workspaceId: input.workspaceId,
        roomId: input.roomId,
        actorUserId: input.actorUserId ?? null,
        request: input.request ?? null,
        sessionKey: input.sessionKey ?? null,
        runId: input.runId ?? null,
        jobId: input.jobId ?? null,
        action: 'run_start' as const,
        amount: {
            count: 1,
        },
    }
    if (providerCandidate !== 'hosted_openrouter') {
        await assertHostedQuotaAllowed(quotaCheck)
        return
    }
    const [creditsResult, policyResult] = await Promise.allSettled([
        assertHostedProviderCreditsAvailable({
            env: input.env,
            workspaceId: input.workspaceId,
        }),
        readHostedQuotaPolicy({
            env: input.env,
            workspaceId: input.workspaceId,
        }),
    ])
    if (creditsResult.status === 'rejected') {
        throw creditsResult.reason
    }
    await assertHostedQuotaAllowed(
        quotaCheck,
        policyResult.status === 'fulfilled' ? { policy: policyResult.value } : undefined,
    )
}
