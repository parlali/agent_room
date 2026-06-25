import type { AgentRoomHostedEnv } from './bindings'
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
}): Promise<void> {
    const runtime = await getHostedRuntimeState(input)
    const providerCandidate = runtime?.row.providerCandidate ?? null
    if (!providerCandidate) {
        throw new Error('Hosted runtime provider binding is missing')
    }
    if (providerCandidate !== 'hosted_openrouter') {
        return
    }
    await assertHostedProviderCreditsAvailable({
        env: input.env,
        workspaceId: input.workspaceId,
    })
}
