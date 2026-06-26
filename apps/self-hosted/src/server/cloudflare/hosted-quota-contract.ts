import type { AgentRoomHostedEnv } from './bindings'
import { hostedJsonResponse } from './hosted-worker-response'
import {
    hostedQuotaActions,
    type HostedQuotaAction,
    type HostedQuotaAmount,
    type HostedQuotaScope,
} from '../rooms/hosted-quota-contract'

export {
    hostedQuotaActions,
    hostedQuotaScopes,
    type HostedQuotaAction,
    type HostedQuotaAmount,
    type HostedQuotaScope,
} from '../rooms/hosted-quota-contract'

export const hostedQuotaPolicyStatuses = ['active', 'restricted', 'suspended'] as const
export const hostedQuotaDecisions = ['allowed', 'denied'] as const

export interface HostedQuotaCheckInput {
    env: AgentRoomHostedEnv
    workspaceId: string
    action: HostedQuotaAction
    actorUserId?: string | null
    roomId?: string | null
    sessionKey?: string | null
    runId?: string | null
    jobId?: string | null
    request?: Request | null
    providerPath?: string | null
    amount?: HostedQuotaAmount
    consume?: boolean
    skipConcurrency?: boolean
    now?: Date
}

export interface HostedQuotaLimits {
    maxWorkspaceRuntimeStartsPerHour: number
    maxWorkspaceRunStartsPerMinute: number
    maxUserRunStartsPerMinute: number
    maxIpRunStartsPerMinute: number
    maxRoomRunStartsPerMinute: number
    maxWorkspaceProviderRequestsPerMinute: number
    maxRoomProviderRequestsPerMinute: number
    maxWorkspaceWebRequestsPerMinute: number
    maxRoomWebRequestsPerMinute: number
    maxWorkspaceBrowserbaseActiveSessions: number
    maxRoomBrowserbaseActiveSessions: number
    maxWorkspaceBrowserbaseSessionsPerHour: number
    maxRoomBrowserbaseSessionsPerHour: number
    maxDailySpendCentsPerWorkspace: number
    maxMonthlySpendCentsPerWorkspace: number
    maxRunSpendCents: number
    maxWorkspaceStorageBytes: number
    maxRoomStorageBytes: number
    maxWorkspaceFileWriteBytesPerDay: number
    maxRoomFileWriteBytesPerDay: number
    maxRuntimeStateWriteBytesPerDay: number
    maxWorkspaceToolStartsPerMinute: number
    maxRoomToolStartsPerMinute: number
}

export type HostedQuotaCapability =
    | 'runtime'
    | 'hosted_models'
    | 'managed_web'
    | 'browserbase'
    | 'scheduled_jobs'
    | 'shell'
    | 'storage'
    | 'image_generation'
    | 'document_workers'

export interface HostedQuotaRestrictions {
    disabledActions: HostedQuotaAction[]
    disabledCapabilities: HostedQuotaCapability[]
    disabledRooms: string[]
    disabledUsers: string[]
    disabledProviderPaths: string[]
}

export interface HostedQuotaPolicy {
    status: (typeof hostedQuotaPolicyStatuses)[number]
    limits: HostedQuotaLimits
    restrictions: HostedQuotaRestrictions
}

export type HostedQuotaDenyReason =
    | 'workspace_suspended'
    | 'action_disabled'
    | 'capability_disabled'
    | 'provider_path_disabled'
    | 'scope_rate_limited'
    | 'spend_cap_exceeded'
    | 'storage_quota_exceeded'
    | 'concurrency_limit'
    | 'quota_unavailable'

export interface HostedQuotaDenyDecision {
    reason: HostedQuotaDenyReason
    action: HostedQuotaAction
    scope: HostedQuotaScope
    scopeId: string
    counterKey: string
    limit: number | null
    requested: number | null
    current: number | null
    message: string
}

export interface CounterRule {
    scope: HostedQuotaScope
    scopeId: string
    windowKey: string
    counterKey: string
    amount: number
    limit: number
    reason: HostedQuotaDenyReason
}

export class HostedQuotaDeniedError extends Error {
    readonly decision: HostedQuotaDenyDecision

    constructor(decision: HostedQuotaDenyDecision) {
        super(decision.message)
        this.name = 'HostedQuotaDeniedError'
        this.decision = decision
    }
}

function isHostedQuotaAction(value: unknown): value is HostedQuotaAction {
    return hostedQuotaActions.includes(value as HostedQuotaAction)
}

export function parseHostedQuotaAction(value: unknown): HostedQuotaAction | null {
    return isHostedQuotaAction(value) ? value : null
}

function quotaMessage(decision: Omit<HostedQuotaDenyDecision, 'message'>): string {
    if (decision.reason === 'workspace_suspended') {
        return 'Hosted workspace is suspended'
    }
    if (decision.reason === 'action_disabled') {
        return 'Hosted action is disabled by operator policy'
    }
    if (decision.reason === 'capability_disabled') {
        return 'Hosted capability is disabled by operator policy'
    }
    if (decision.reason === 'provider_path_disabled') {
        return 'Hosted provider path is disabled by operator policy'
    }
    if (decision.reason === 'spend_cap_exceeded') {
        return 'Hosted spend cap reached'
    }
    if (decision.reason === 'storage_quota_exceeded') {
        return 'Hosted storage quota reached'
    }
    if (decision.reason === 'concurrency_limit') {
        return 'Hosted concurrency limit reached'
    }
    if (decision.reason === 'quota_unavailable') {
        return 'Hosted quota check failed closed'
    }
    return 'Hosted rate limit reached'
}

export function deny(input: Omit<HostedQuotaDenyDecision, 'message'>): HostedQuotaDenyDecision {
    return {
        ...input,
        message: quotaMessage(input),
    }
}

function quotaStatusCode(decision: HostedQuotaDenyDecision): number {
    if (
        decision.reason === 'workspace_suspended' ||
        decision.reason === 'action_disabled' ||
        decision.reason === 'capability_disabled' ||
        decision.reason === 'provider_path_disabled'
    ) {
        return 403
    }
    if (decision.reason === 'quota_unavailable') {
        return 503
    }
    if (decision.reason === 'spend_cap_exceeded') {
        return 402
    }
    return 429
}

export function hostedQuotaDeniedResponse(error: unknown): Response | null {
    if (!(error instanceof HostedQuotaDeniedError)) {
        return null
    }
    return hostedJsonResponse(
        {
            ok: false,
            code: 'hosted_quota_denied',
            reason: error.decision.reason,
            action: error.decision.action,
            message: error.decision.message,
        },
        {
            status: quotaStatusCode(error.decision),
        },
    )
}
