import type { AgentRoomHostedEnv } from './bindings'
import { nowIso } from './hosted-json'
import {
    deny,
    HostedQuotaDeniedError,
    type HostedQuotaCheckInput,
    type HostedQuotaPolicy,
} from './hosted-quota-contract'
import { readHostedQuotaPolicy, restrictedByPolicy } from './hosted-quota-policy'
import { counterRules, ipScopeId } from './hosted-quota-rules'
import {
    activeConcurrencyDenial,
    consumeCounters,
    counterDenial,
    recordCounters,
    recordHostedQuotaDenied,
    refundCounters,
    storageDenial,
} from './hosted-quota-store'

export {
    hostedQuotaActions,
    hostedQuotaDecisions,
    HostedQuotaDeniedError,
    hostedQuotaDeniedResponse,
    hostedQuotaPolicyStatuses,
    hostedQuotaScopes,
    parseHostedQuotaAction,
    type HostedQuotaAction,
    type HostedQuotaAmount,
    type HostedQuotaCheckInput,
    type HostedQuotaPolicy,
    type HostedQuotaScope,
} from './hosted-quota-contract'
export { readHostedQuotaPolicy } from './hosted-quota-policy'

async function evaluateHostedQuota(
    input: HostedQuotaCheckInput,
    prefetchedPolicy?: HostedQuotaPolicy,
): Promise<void> {
    const now = input.now ?? new Date()
    const nowString = nowIso(now)
    const policy =
        prefetchedPolicy ??
        (await readHostedQuotaPolicy({
            env: input.env,
            workspaceId: input.workspaceId,
        }))
    const requestIpScope = await ipScopeId(input.request)
    const restriction = restrictedByPolicy({
        policy,
        env: input.env,
        check: input,
    })
    const denial =
        restriction ??
        (await activeConcurrencyDenial({
            check: input,
            policy,
        })) ??
        (await storageDenial({
            check: input,
            policy,
        }))
    if (denial) {
        await recordHostedQuotaDenied({
            check: input,
            decision: denial,
            now: nowString,
        })
        throw new HostedQuotaDeniedError(denial)
    }
    const rules = counterRules({
        check: input,
        policy,
        ipScopeId: requestIpScope,
        now,
    })
    const preCounterDenial = await counterDenial({
        check: input,
        rules,
    })
    if (preCounterDenial) {
        await recordHostedQuotaDenied({
            check: input,
            decision: preCounterDenial,
            now: nowString,
        })
        throw new HostedQuotaDeniedError(preCounterDenial)
    }
    if (input.consume === false) {
        return
    }
    const consumeDenial = await consumeCounters({
        check: input,
        rules,
        now: nowString,
    })
    if (consumeDenial) {
        await recordHostedQuotaDenied({
            check: input,
            decision: consumeDenial,
            now: nowString,
        })
        throw new HostedQuotaDeniedError(consumeDenial)
    }
}

interface HostedProviderSpendCounterInput {
    env: AgentRoomHostedEnv
    workspaceId: string
    roomId?: string | null
    sessionKey?: string | null
    runId?: string | null
    jobId?: string | null
    action: HostedQuotaCheckInput['action']
    cents: number
    now?: Date
}

async function hostedProviderSpendCounterRules(input: HostedProviderSpendCounterInput): Promise<{
    check: HostedQuotaCheckInput
    rules: ReturnType<typeof counterRules>
    now: Date
} | null> {
    if (!Number.isFinite(input.cents) || input.cents <= 0) {
        return null
    }
    const now = input.now ?? new Date()
    const policy = await readHostedQuotaPolicy({
        env: input.env,
        workspaceId: input.workspaceId,
    })
    const check: HostedQuotaCheckInput = {
        env: input.env,
        workspaceId: input.workspaceId,
        roomId: input.roomId ?? null,
        sessionKey: input.sessionKey ?? null,
        runId: input.runId ?? null,
        jobId: input.jobId ?? null,
        action: input.action,
        amount: {
            count: 0,
            cents: Math.ceil(input.cents),
        },
    }
    const rules = counterRules({
        check,
        policy,
        ipScopeId: '',
        now,
    }).filter((rule) => rule.counterKey === 'spend_cents')
    return {
        check,
        rules,
        now,
    }
}

export async function recordHostedProviderSpend(
    input: HostedProviderSpendCounterInput,
): Promise<void> {
    const prepared = await hostedProviderSpendCounterRules(input)
    if (!prepared) {
        return
    }
    await recordCounters({
        check: prepared.check,
        rules: prepared.rules,
        now: nowIso(prepared.now),
    })
}

export async function refundHostedProviderSpend(
    input: HostedProviderSpendCounterInput,
): Promise<void> {
    const prepared = await hostedProviderSpendCounterRules(input)
    if (!prepared) {
        return
    }
    await refundCounters({
        check: prepared.check,
        rules: prepared.rules,
        now: nowIso(prepared.now),
    })
    console.log('Hosted provider spend counters refunded after failed provider call', {
        workspaceId: input.workspaceId,
        action: input.action,
        cents: Math.ceil(input.cents),
    })
}

export async function assertHostedQuotaAllowed(
    input: HostedQuotaCheckInput,
    options?: { policy?: HostedQuotaPolicy },
): Promise<void> {
    try {
        await evaluateHostedQuota(input, options?.policy)
    } catch (error) {
        if (error instanceof HostedQuotaDeniedError) {
            throw error
        }
        const decision = deny({
            reason: 'quota_unavailable',
            action: input.action,
            scope: 'workspace',
            scopeId: input.workspaceId,
            counterKey: input.action,
            limit: null,
            requested: null,
            current: null,
        })
        await recordHostedQuotaDenied({
            check: input,
            decision,
            now: nowIso(input.now),
        }).catch((logError) => {
            console.error(
                'Hosted quota denial logging failed',
                logError instanceof Error ? logError.message : logError,
            )
        })
        console.error(
            'Hosted quota check failed closed',
            error instanceof Error ? error.message : error,
        )
        throw new HostedQuotaDeniedError(decision)
    }
}
