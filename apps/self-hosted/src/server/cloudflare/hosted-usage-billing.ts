import type { AgentRoomHostedEnv } from './bindings'
import {
    appendHostedUsageEvent,
    debitHostedBalance,
    ensureHostedBillingAccount,
    readHostedBillingAccount,
} from './hosted-billing-repository'
import { applyUsageMarkupMicros, centsFromMicrosCeil } from './hosted-billing-types'
import { resolveHostedConfig } from './hosted-config'

export interface HostedProviderUsageInput {
    env: AgentRoomHostedEnv
    workspaceId: string
    roomId: string | null
    sessionKey: string | null
    runId: string | null
    jobId: string | null
    provider: 'openrouter' | 'brave'
    model: string | null
    inputTokens: number | null
    outputTokens: number | null
    cachedTokens: number | null
    costMicros: number
    now?: Date
}

export async function assertHostedProviderCreditsAvailable(input: {
    env: AgentRoomHostedEnv
    workspaceId: string
    estimatedCostMicros?: number
}): Promise<void> {
    const config = resolveHostedConfig(input.env)
    await ensureHostedBillingAccount({
        env: input.env,
        workspaceId: input.workspaceId,
    })
    const account = await readHostedBillingAccount(input)
    const total = account.includedBalanceCents + account.purchasedBalanceCents
    const required =
        input.estimatedCostMicros !== undefined
            ? centsFromMicrosCeil(
                  applyUsageMarkupMicros(input.estimatedCostMicros, config.billing.usageMarkupBps),
              )
            : 1
    if (total < required) {
        throw new Error('Hosted billing balance is exhausted')
    }
}

export async function recordHostedProviderUsage(input: HostedProviderUsageInput): Promise<{
    usageEventId: string
    debitedCents: number
    ledgerEntryId: string | null
}> {
    const config = resolveHostedConfig(input.env)
    await ensureHostedBillingAccount({
        env: input.env,
        workspaceId: input.workspaceId,
    })
    const markupBps = config.billing.usageMarkupBps
    const billedMicros = applyUsageMarkupMicros(input.costMicros, markupBps)
    const amountCents = centsFromMicrosCeil(billedMicros)
    const usageEventId = await appendHostedUsageEvent({
        env: input.env,
        workspaceId: input.workspaceId,
        roomId: input.roomId,
        sessionKey: input.sessionKey,
        runId: input.runId,
        jobId: input.jobId,
        kind: 'provider',
        provider: input.provider,
        model: input.model,
        toolName: null,
        inputTokens: input.inputTokens,
        outputTokens: input.outputTokens,
        cachedTokens: input.cachedTokens,
        costMicros: input.costMicros,
        billingStatus: amountCents > 0 ? 'pending' : 'not_billable',
        now: input.now,
    })
    if (amountCents === 0) {
        return {
            usageEventId,
            debitedCents: 0,
            ledgerEntryId: null,
        }
    }
    const ledger = await debitHostedBalance({
        env: input.env,
        workspaceId: input.workspaceId,
        source: input.provider === 'openrouter' ? 'hosted_openrouter_usage' : 'hosted_brave_usage',
        amountCents,
        usageEventId,
        idempotencyKey: `hosted_usage:${usageEventId}`,
        metadata: {
            provider: input.provider,
            model: input.model,
            costMicros: input.costMicros,
            markupBps,
            billedMicros,
        },
        now: input.now,
    })
    return {
        usageEventId,
        debitedCents: amountCents,
        ledgerEntryId: ledger.id,
    }
}
