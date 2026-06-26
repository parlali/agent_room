import { nowIso } from './hosted-json'
import { deny, HostedQuotaDeniedError, type HostedQuotaCheckInput } from './hosted-quota-contract'
import { readHostedQuotaPolicy, restrictedByPolicy } from './hosted-quota-policy'
import { counterRules, ipScopeId } from './hosted-quota-rules'
import {
    activeConcurrencyDenial,
    consumeCounters,
    counterDenial,
    recordHostedQuotaDenied,
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
    type HostedQuotaScope,
} from './hosted-quota-contract'

async function evaluateHostedQuota(input: HostedQuotaCheckInput): Promise<void> {
    const now = input.now ?? new Date()
    const nowString = nowIso(now)
    const policy = await readHostedQuotaPolicy({
        env: input.env,
        workspaceId: input.workspaceId,
    })
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

export async function assertHostedQuotaAllowed(input: HostedQuotaCheckInput): Promise<void> {
    try {
        await evaluateHostedQuota(input)
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
