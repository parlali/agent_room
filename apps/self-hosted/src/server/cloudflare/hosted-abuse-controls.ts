import type { JsonValue } from '#/domain/domain-types'
import type { AgentRoomHostedEnv } from './bindings'
import { appendHostedAudit } from './hosted-audit'
import type { HostedBillingReservationProvider } from './hosted-billing-types'
import { appendHostedUsageEvent } from './hosted-billing-repository'
import { resolveHostedConfig } from './hosted-config'
import { nowIso, objectRecord, parseJsonValue, toJsonValue } from './hosted-json'
import { hostedJsonResponse } from './hosted-worker-response'

export const hostedQuotaScopes = [
    'workspace',
    'user',
    'ip',
    'room',
    'session',
    'job',
    'runtime',
    'provider',
] as const

export const hostedQuotaActions = [
    'runtime_start',
    'run_start',
    'provider_openrouter',
    'provider_brave',
    'provider_browserbase',
    'provider_fetch_url',
    'browserbase_session_start',
    'file_upload',
    'runtime_file_sync',
    'runtime_state_sync',
    'scheduled_job_claim',
    'shell_command',
    'document_worker',
    'image_generation',
] as const

export const hostedQuotaPolicyStatuses = ['active', 'restricted', 'suspended'] as const
export const hostedQuotaDecisions = ['allowed', 'denied'] as const

export type HostedQuotaScope = (typeof hostedQuotaScopes)[number]
export type HostedQuotaAction = (typeof hostedQuotaActions)[number]

export interface HostedQuotaAmount {
    count?: number
    bytes?: number
    storageBytes?: number
    cents?: number
}

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
    now?: Date
}

interface HostedQuotaLimits {
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

interface HostedQuotaRestrictions {
    disabledActions: HostedQuotaAction[]
    disabledCapabilities: HostedQuotaCapability[]
    disabledRooms: string[]
    disabledUsers: string[]
    disabledProviderPaths: string[]
}

type HostedQuotaCapability =
    | 'runtime'
    | 'hosted_models'
    | 'managed_web'
    | 'browserbase'
    | 'scheduled_jobs'
    | 'shell'
    | 'storage'
    | 'image_generation'
    | 'document_workers'

interface HostedQuotaPolicy {
    status: (typeof hostedQuotaPolicyStatuses)[number]
    limits: HostedQuotaLimits
    restrictions: HostedQuotaRestrictions
}

interface HostedQuotaDenyDecision {
    reason:
        | 'workspace_suspended'
        | 'action_disabled'
        | 'capability_disabled'
        | 'provider_path_disabled'
        | 'scope_rate_limited'
        | 'spend_cap_exceeded'
        | 'storage_quota_exceeded'
        | 'concurrency_limit'
        | 'quota_unavailable'
    action: HostedQuotaAction
    scope: HostedQuotaScope
    scopeId: string
    counterKey: string
    limit: number | null
    requested: number | null
    current: number | null
    message: string
}

interface CounterRule {
    scope: HostedQuotaScope
    scopeId: string
    windowKey: string
    counterKey: string
    amount: number
    limit: number
    reason: HostedQuotaDenyDecision['reason']
}

const defaultHostedQuotaLimits: HostedQuotaLimits = {
    maxWorkspaceRuntimeStartsPerHour: 20,
    maxWorkspaceRunStartsPerMinute: 30,
    maxUserRunStartsPerMinute: 20,
    maxIpRunStartsPerMinute: 30,
    maxRoomRunStartsPerMinute: 10,
    maxWorkspaceProviderRequestsPerMinute: 120,
    maxRoomProviderRequestsPerMinute: 60,
    maxWorkspaceWebRequestsPerMinute: 120,
    maxRoomWebRequestsPerMinute: 60,
    maxWorkspaceBrowserbaseActiveSessions: 3,
    maxRoomBrowserbaseActiveSessions: 1,
    maxWorkspaceBrowserbaseSessionsPerHour: 30,
    maxRoomBrowserbaseSessionsPerHour: 10,
    maxDailySpendCentsPerWorkspace: 5000,
    maxMonthlySpendCentsPerWorkspace: 100000,
    maxRunSpendCents: 500,
    maxWorkspaceStorageBytes: 2 * 1024 * 1024 * 1024,
    maxRoomStorageBytes: 512 * 1024 * 1024,
    maxWorkspaceFileWriteBytesPerDay: 512 * 1024 * 1024,
    maxRoomFileWriteBytesPerDay: 256 * 1024 * 1024,
    maxRuntimeStateWriteBytesPerDay: 128 * 1024 * 1024,
    maxWorkspaceToolStartsPerMinute: 120,
    maxRoomToolStartsPerMinute: 60,
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

function safeIntegerAmount(value: number | undefined, fallback: number): number {
    if (value === undefined) {
        return fallback
    }
    return Number.isSafeInteger(value) && value >= 0 ? value : fallback
}

function amountCount(input: HostedQuotaCheckInput): number {
    return safeIntegerAmount(input.amount?.count, 1)
}

function amountBytes(input: HostedQuotaCheckInput): number {
    return safeIntegerAmount(input.amount?.bytes, 0)
}

function amountStorageBytes(input: HostedQuotaCheckInput): number {
    return safeIntegerAmount(input.amount?.storageBytes, amountBytes(input))
}

function amountCents(input: HostedQuotaCheckInput): number {
    return safeIntegerAmount(input.amount?.cents, 0)
}

function numberLimit(record: Record<string, unknown>, key: keyof HostedQuotaLimits): number {
    const value = record[key]
    return Number.isSafeInteger(value) && Number(value) >= 0
        ? Number(value)
        : defaultHostedQuotaLimits[key]
}

function stringArray(value: unknown): string[] {
    if (!Array.isArray(value)) {
        return []
    }
    return Array.from(new Set(value.filter((entry): entry is string => typeof entry === 'string')))
}

function actionArray(value: unknown): HostedQuotaAction[] {
    return stringArray(value).filter(isHostedQuotaAction)
}

function capabilityArray(value: unknown): HostedQuotaCapability[] {
    const allowed = new Set<HostedQuotaCapability>([
        'runtime',
        'hosted_models',
        'managed_web',
        'browserbase',
        'scheduled_jobs',
        'shell',
        'storage',
        'image_generation',
        'document_workers',
    ])
    return stringArray(value).filter((entry): entry is HostedQuotaCapability =>
        allowed.has(entry as HostedQuotaCapability),
    )
}

function limitsFromJson(value: JsonValue): HostedQuotaLimits {
    const record = objectRecord(value)
    return {
        maxWorkspaceRuntimeStartsPerHour: numberLimit(record, 'maxWorkspaceRuntimeStartsPerHour'),
        maxWorkspaceRunStartsPerMinute: numberLimit(record, 'maxWorkspaceRunStartsPerMinute'),
        maxUserRunStartsPerMinute: numberLimit(record, 'maxUserRunStartsPerMinute'),
        maxIpRunStartsPerMinute: numberLimit(record, 'maxIpRunStartsPerMinute'),
        maxRoomRunStartsPerMinute: numberLimit(record, 'maxRoomRunStartsPerMinute'),
        maxWorkspaceProviderRequestsPerMinute: numberLimit(
            record,
            'maxWorkspaceProviderRequestsPerMinute',
        ),
        maxRoomProviderRequestsPerMinute: numberLimit(record, 'maxRoomProviderRequestsPerMinute'),
        maxWorkspaceWebRequestsPerMinute: numberLimit(record, 'maxWorkspaceWebRequestsPerMinute'),
        maxRoomWebRequestsPerMinute: numberLimit(record, 'maxRoomWebRequestsPerMinute'),
        maxWorkspaceBrowserbaseActiveSessions: numberLimit(
            record,
            'maxWorkspaceBrowserbaseActiveSessions',
        ),
        maxRoomBrowserbaseActiveSessions: numberLimit(record, 'maxRoomBrowserbaseActiveSessions'),
        maxWorkspaceBrowserbaseSessionsPerHour: numberLimit(
            record,
            'maxWorkspaceBrowserbaseSessionsPerHour',
        ),
        maxRoomBrowserbaseSessionsPerHour: numberLimit(record, 'maxRoomBrowserbaseSessionsPerHour'),
        maxDailySpendCentsPerWorkspace: numberLimit(record, 'maxDailySpendCentsPerWorkspace'),
        maxMonthlySpendCentsPerWorkspace: numberLimit(record, 'maxMonthlySpendCentsPerWorkspace'),
        maxRunSpendCents: numberLimit(record, 'maxRunSpendCents'),
        maxWorkspaceStorageBytes: numberLimit(record, 'maxWorkspaceStorageBytes'),
        maxRoomStorageBytes: numberLimit(record, 'maxRoomStorageBytes'),
        maxWorkspaceFileWriteBytesPerDay: numberLimit(record, 'maxWorkspaceFileWriteBytesPerDay'),
        maxRoomFileWriteBytesPerDay: numberLimit(record, 'maxRoomFileWriteBytesPerDay'),
        maxRuntimeStateWriteBytesPerDay: numberLimit(record, 'maxRuntimeStateWriteBytesPerDay'),
        maxWorkspaceToolStartsPerMinute: numberLimit(record, 'maxWorkspaceToolStartsPerMinute'),
        maxRoomToolStartsPerMinute: numberLimit(record, 'maxRoomToolStartsPerMinute'),
    }
}

function restrictionsFromJson(value: JsonValue): HostedQuotaRestrictions {
    const record = objectRecord(value)
    return {
        disabledActions: actionArray(record.disabledActions),
        disabledCapabilities: capabilityArray(record.disabledCapabilities),
        disabledRooms: stringArray(record.disabledRooms),
        disabledUsers: stringArray(record.disabledUsers),
        disabledProviderPaths: stringArray(record.disabledProviderPaths),
    }
}

function capabilityForAction(action: HostedQuotaAction): HostedQuotaCapability {
    switch (action) {
        case 'provider_openrouter':
            return 'hosted_models'
        case 'provider_brave':
        case 'provider_fetch_url':
            return 'managed_web'
        case 'provider_browserbase':
        case 'browserbase_session_start':
            return 'browserbase'
        case 'scheduled_job_claim':
            return 'scheduled_jobs'
        case 'shell_command':
            return 'shell'
        case 'file_upload':
        case 'runtime_file_sync':
        case 'runtime_state_sync':
            return 'storage'
        case 'image_generation':
            return 'image_generation'
        case 'document_worker':
            return 'document_workers'
        case 'runtime_start':
        case 'run_start':
            return 'runtime'
    }
}

function globalDisabledCapabilities(env: AgentRoomHostedEnv): HostedQuotaCapability[] {
    const config = resolveHostedConfig(env)
    const disabled: HostedQuotaCapability[] = []
    if (config.killSwitches.runtimeExecution) disabled.push('runtime')
    if (config.killSwitches.hostedModels) disabled.push('hosted_models')
    if (config.killSwitches.managedWeb) disabled.push('managed_web')
    if (config.killSwitches.browserbase) disabled.push('browserbase')
    if (config.killSwitches.scheduledJobs) disabled.push('scheduled_jobs')
    if (config.killSwitches.shell) disabled.push('shell')
    if (config.killSwitches.storage) disabled.push('storage')
    if (config.killSwitches.imageGeneration) disabled.push('image_generation')
    if (config.killSwitches.documentWorkers) disabled.push('document_workers')
    return disabled
}

async function readHostedQuotaPolicy(input: {
    env: AgentRoomHostedEnv
    workspaceId: string
}): Promise<HostedQuotaPolicy> {
    const row = await input.env.AGENT_ROOM_DB.prepare(
        `
            SELECT status, limits, restrictions
            FROM hosted_quota_policy
            WHERE workspace_id = ?1
            LIMIT 1
        `,
    )
        .bind(input.workspaceId)
        .first<{ status: HostedQuotaPolicy['status']; limits: string; restrictions: string }>()
    const limits = row ? parseJsonValue(row.limits, {}) : {}
    const restrictions = row ? parseJsonValue(row.restrictions, {}) : {}
    return {
        status: row?.status ?? 'active',
        limits: limitsFromJson(limits),
        restrictions: restrictionsFromJson(restrictions),
    }
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

function deny(input: Omit<HostedQuotaDenyDecision, 'message'>): HostedQuotaDenyDecision {
    return {
        ...input,
        message: quotaMessage(input),
    }
}

function restrictedByPolicy(input: {
    policy: HostedQuotaPolicy
    env: AgentRoomHostedEnv
    check: HostedQuotaCheckInput
}): HostedQuotaDenyDecision | null {
    if (input.policy.status === 'suspended') {
        return deny({
            reason: 'workspace_suspended',
            action: input.check.action,
            scope: 'workspace',
            scopeId: input.check.workspaceId,
            counterKey: 'workspace_status',
            limit: null,
            requested: null,
            current: null,
        })
    }
    if (input.policy.restrictions.disabledActions.includes(input.check.action)) {
        return deny({
            reason: 'action_disabled',
            action: input.check.action,
            scope: 'workspace',
            scopeId: input.check.workspaceId,
            counterKey: input.check.action,
            limit: null,
            requested: null,
            current: null,
        })
    }
    const capability = capabilityForAction(input.check.action)
    const disabledCapabilities = new Set([
        ...globalDisabledCapabilities(input.env),
        ...input.policy.restrictions.disabledCapabilities,
    ])
    if (disabledCapabilities.has(capability)) {
        return deny({
            reason: 'capability_disabled',
            action: input.check.action,
            scope: 'workspace',
            scopeId: input.check.workspaceId,
            counterKey: capability,
            limit: null,
            requested: null,
            current: null,
        })
    }
    if (
        input.check.actorUserId &&
        input.policy.restrictions.disabledUsers.includes(input.check.actorUserId)
    ) {
        return deny({
            reason: 'action_disabled',
            action: input.check.action,
            scope: 'user',
            scopeId: input.check.actorUserId,
            counterKey: input.check.action,
            limit: null,
            requested: null,
            current: null,
        })
    }
    if (
        input.check.roomId &&
        input.policy.restrictions.disabledRooms.includes(input.check.roomId)
    ) {
        return deny({
            reason: 'action_disabled',
            action: input.check.action,
            scope: 'room',
            scopeId: input.check.roomId,
            counterKey: input.check.action,
            limit: null,
            requested: null,
            current: null,
        })
    }
    if (
        input.check.providerPath &&
        input.policy.restrictions.disabledProviderPaths.includes(input.check.providerPath)
    ) {
        return deny({
            reason: 'provider_path_disabled',
            action: input.check.action,
            scope: 'provider',
            scopeId: input.check.providerPath,
            counterKey: input.check.action,
            limit: null,
            requested: null,
            current: null,
        })
    }
    return null
}

function isoMinute(now: Date): string {
    return `${now.toISOString().slice(0, 16)}Z`
}

function isoHour(now: Date): string {
    return `${now.toISOString().slice(0, 13)}Z`
}

function isoDay(now: Date): string {
    return now.toISOString().slice(0, 10)
}

function isoMonth(now: Date): string {
    return now.toISOString().slice(0, 7)
}

async function hashScopeId(value: string): Promise<string> {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
    return Array.from(new Uint8Array(digest))
        .map((byte) => byte.toString(16).padStart(2, '0'))
        .join('')
}

function requestIp(request: Request | null | undefined): string | null {
    const candidate =
        request?.headers.get('cf-connecting-ip') ??
        request?.headers.get('x-real-ip') ??
        request?.headers.get('x-forwarded-for')?.split(',')[0] ??
        null
    return candidate?.trim() || null
}

async function ipScopeId(request: Request | null | undefined): Promise<string> {
    const ip = requestIp(request)
    return ip ? `ip_${(await hashScopeId(ip)).slice(0, 40)}` : 'ip_unknown'
}

function providerFromAction(action: HostedQuotaAction): HostedBillingReservationProvider | null {
    if (action === 'provider_openrouter') return 'openrouter'
    if (action === 'provider_brave') return 'brave'
    if (action === 'provider_browserbase' || action === 'browserbase_session_start') {
        return 'browserbase'
    }
    if (action === 'provider_fetch_url') return 'fetch_url'
    return null
}

function usageKindForAction(action: HostedQuotaAction): string {
    if (providerFromAction(action)) return 'provider'
    if (action === 'scheduled_job_claim') return 'job'
    if (action === 'document_worker') return 'document_worker'
    if (action === 'image_generation') return 'image'
    if (action === 'shell_command') return 'tool'
    return 'run'
}

function counterRules(input: {
    check: HostedQuotaCheckInput
    policy: HostedQuotaPolicy
    ipScopeId: string
    now: Date
}): CounterRule[] {
    const rules: CounterRule[] = []
    const count = amountCount(input.check)
    const bytes = amountStorageBytes(input.check)
    const cents = amountCents(input.check)
    const minute = isoMinute(input.now)
    const hour = isoHour(input.now)
    const day = isoDay(input.now)
    const month = isoMonth(input.now)
    const add = (rule: CounterRule | null) => {
        if (rule && rule.amount > 0) {
            rules.push(rule)
        }
    }

    if (input.check.action === 'runtime_start') {
        add({
            scope: 'workspace',
            scopeId: input.check.workspaceId,
            windowKey: hour,
            counterKey: 'runtime_starts',
            amount: count,
            limit: input.policy.limits.maxWorkspaceRuntimeStartsPerHour,
            reason: 'scope_rate_limited',
        })
    }

    if (input.check.action === 'run_start') {
        add({
            scope: 'workspace',
            scopeId: input.check.workspaceId,
            windowKey: minute,
            counterKey: 'run_starts',
            amount: count,
            limit: input.policy.limits.maxWorkspaceRunStartsPerMinute,
            reason: 'scope_rate_limited',
        })
        add({
            scope: 'ip',
            scopeId: input.ipScopeId,
            windowKey: minute,
            counterKey: 'run_starts',
            amount: count,
            limit: input.policy.limits.maxIpRunStartsPerMinute,
            reason: 'scope_rate_limited',
        })
        if (input.check.actorUserId) {
            add({
                scope: 'user',
                scopeId: input.check.actorUserId,
                windowKey: minute,
                counterKey: 'run_starts',
                amount: count,
                limit: input.policy.limits.maxUserRunStartsPerMinute,
                reason: 'scope_rate_limited',
            })
        }
        if (input.check.roomId) {
            add({
                scope: 'room',
                scopeId: input.check.roomId,
                windowKey: minute,
                counterKey: 'run_starts',
                amount: count,
                limit: input.policy.limits.maxRoomRunStartsPerMinute,
                reason: 'scope_rate_limited',
            })
        }
    }

    if (
        input.check.action === 'provider_openrouter' ||
        input.check.action === 'provider_brave' ||
        input.check.action === 'provider_browserbase' ||
        input.check.action === 'provider_fetch_url'
    ) {
        const webAction =
            input.check.action === 'provider_brave' ||
            input.check.action === 'provider_fetch_url' ||
            input.check.action === 'provider_browserbase'
        add({
            scope: 'workspace',
            scopeId: input.check.workspaceId,
            windowKey: minute,
            counterKey: webAction ? 'web_requests' : 'provider_requests',
            amount: count,
            limit: webAction
                ? input.policy.limits.maxWorkspaceWebRequestsPerMinute
                : input.policy.limits.maxWorkspaceProviderRequestsPerMinute,
            reason: 'scope_rate_limited',
        })
        if (input.check.roomId) {
            add({
                scope: 'room',
                scopeId: input.check.roomId,
                windowKey: minute,
                counterKey: webAction ? 'web_requests' : 'provider_requests',
                amount: count,
                limit: webAction
                    ? input.policy.limits.maxRoomWebRequestsPerMinute
                    : input.policy.limits.maxRoomProviderRequestsPerMinute,
                reason: 'scope_rate_limited',
            })
        }
    }

    if (input.check.action === 'browserbase_session_start') {
        add({
            scope: 'workspace',
            scopeId: input.check.workspaceId,
            windowKey: hour,
            counterKey: 'browserbase_sessions',
            amount: count,
            limit: input.policy.limits.maxWorkspaceBrowserbaseSessionsPerHour,
            reason: 'scope_rate_limited',
        })
        if (input.check.roomId) {
            add({
                scope: 'room',
                scopeId: input.check.roomId,
                windowKey: hour,
                counterKey: 'browserbase_sessions',
                amount: count,
                limit: input.policy.limits.maxRoomBrowserbaseSessionsPerHour,
                reason: 'scope_rate_limited',
            })
        }
    }

    if (
        input.check.action === 'file_upload' ||
        input.check.action === 'runtime_file_sync' ||
        input.check.action === 'runtime_state_sync'
    ) {
        add({
            scope: 'workspace',
            scopeId: input.check.workspaceId,
            windowKey: day,
            counterKey: 'file_write_bytes',
            amount: bytes,
            limit: input.policy.limits.maxWorkspaceFileWriteBytesPerDay,
            reason: 'storage_quota_exceeded',
        })
        if (input.check.roomId) {
            add({
                scope: 'room',
                scopeId: input.check.roomId,
                windowKey: day,
                counterKey: 'file_write_bytes',
                amount: bytes,
                limit:
                    input.check.action === 'runtime_state_sync'
                        ? input.policy.limits.maxRuntimeStateWriteBytesPerDay
                        : input.policy.limits.maxRoomFileWriteBytesPerDay,
                reason: 'storage_quota_exceeded',
            })
        }
    }

    if (
        input.check.action === 'shell_command' ||
        input.check.action === 'document_worker' ||
        input.check.action === 'image_generation'
    ) {
        add({
            scope: 'workspace',
            scopeId: input.check.workspaceId,
            windowKey: minute,
            counterKey: 'tool_starts',
            amount: count,
            limit: input.policy.limits.maxWorkspaceToolStartsPerMinute,
            reason: 'scope_rate_limited',
        })
        if (input.check.roomId) {
            add({
                scope: 'room',
                scopeId: input.check.roomId,
                windowKey: minute,
                counterKey: 'tool_starts',
                amount: count,
                limit: input.policy.limits.maxRoomToolStartsPerMinute,
                reason: 'scope_rate_limited',
            })
        }
    }

    if (cents > 0) {
        add({
            scope: 'workspace',
            scopeId: input.check.workspaceId,
            windowKey: day,
            counterKey: 'spend_cents',
            amount: cents,
            limit: input.policy.limits.maxDailySpendCentsPerWorkspace,
            reason: 'spend_cap_exceeded',
        })
        add({
            scope: 'workspace',
            scopeId: input.check.workspaceId,
            windowKey: month,
            counterKey: 'spend_cents',
            amount: cents,
            limit: input.policy.limits.maxMonthlySpendCentsPerWorkspace,
            reason: 'spend_cap_exceeded',
        })
        if (input.check.runId) {
            add({
                scope: 'runtime',
                scopeId: `${input.check.workspaceId}:${input.check.runId}`,
                windowKey: 'run',
                counterKey: 'spend_cents',
                amount: cents,
                limit: input.policy.limits.maxRunSpendCents,
                reason: 'spend_cap_exceeded',
            })
        }
    }

    return rules
}

async function readCounter(input: { env: AgentRoomHostedEnv; rule: CounterRule }): Promise<number> {
    const row = await input.env.AGENT_ROOM_DB.prepare(
        `
            SELECT quantity
            FROM hosted_quota_counter
            WHERE scope = ?1
              AND scope_id = ?2
              AND window_key = ?3
              AND counter_key = ?4
            LIMIT 1
        `,
    )
        .bind(input.rule.scope, input.rule.scopeId, input.rule.windowKey, input.rule.counterKey)
        .first<{ quantity: number }>()
    return row?.quantity ?? 0
}

async function incrementCounter(input: {
    env: AgentRoomHostedEnv
    rule: CounterRule
    now: string
}): Promise<boolean> {
    if (input.rule.amount > input.rule.limit) {
        return false
    }
    const result = await input.env.AGENT_ROOM_DB.prepare(
        `
            INSERT INTO hosted_quota_counter (
                scope,
                scope_id,
                window_key,
                counter_key,
                quantity,
                updated_at
            )
            VALUES (?1, ?2, ?3, ?4, ?5, ?6)
            ON CONFLICT(scope, scope_id, window_key, counter_key) DO UPDATE SET
                quantity = quantity + excluded.quantity,
                updated_at = excluded.updated_at
            WHERE hosted_quota_counter.quantity + excluded.quantity <= ?7
        `,
    )
        .bind(
            input.rule.scope,
            input.rule.scopeId,
            input.rule.windowKey,
            input.rule.counterKey,
            input.rule.amount,
            input.now,
            input.rule.limit,
        )
        .run()
    return (result.meta.changes ?? 0) > 0
}

async function countActiveBrowserbaseSessions(input: {
    env: AgentRoomHostedEnv
    workspaceId: string
    roomId?: string | null
}): Promise<number> {
    const roomClause = input.roomId ? 'AND room_id = ?2' : ''
    const row = input.roomId
        ? await input.env.AGENT_ROOM_DB.prepare(
              `
                  SELECT COUNT(*) AS activeCount
                  FROM hosted_browserbase_session
                  WHERE workspace_id = ?1
                    ${roomClause}
                    AND status IN ('active', 'release_requested')
              `,
          )
              .bind(input.workspaceId, input.roomId)
              .first<{ activeCount: number }>()
        : await input.env.AGENT_ROOM_DB.prepare(
              `
                  SELECT COUNT(*) AS activeCount
                  FROM hosted_browserbase_session
                  WHERE workspace_id = ?1
                    AND status IN ('active', 'release_requested')
              `,
          )
              .bind(input.workspaceId)
              .first<{ activeCount: number }>()
    return row?.activeCount ?? 0
}

async function storageBytes(input: {
    env: AgentRoomHostedEnv
    workspaceId: string
    roomId?: string | null
}): Promise<number> {
    const row = input.roomId
        ? await input.env.AGENT_ROOM_DB.prepare(
              `
                  SELECT COALESCE(SUM(byte_length), 0) AS byteLength
                  FROM hosted_room_file_index
                  WHERE workspace_id = ?1
                    AND room_id = ?2
                    AND kind = 'file'
              `,
          )
              .bind(input.workspaceId, input.roomId)
              .first<{ byteLength: number }>()
        : await input.env.AGENT_ROOM_DB.prepare(
              `
                  SELECT COALESCE(SUM(byte_length), 0) AS byteLength
                  FROM hosted_room_file_index
                  WHERE workspace_id = ?1
                    AND kind = 'file'
              `,
          )
              .bind(input.workspaceId)
              .first<{ byteLength: number }>()
    return Number(row?.byteLength ?? 0)
}

async function activeConcurrencyDenial(input: {
    check: HostedQuotaCheckInput
    policy: HostedQuotaPolicy
}): Promise<HostedQuotaDenyDecision | null> {
    if (input.check.action !== 'browserbase_session_start') {
        return null
    }
    const workspaceActive = await countActiveBrowserbaseSessions({
        env: input.check.env,
        workspaceId: input.check.workspaceId,
    })
    if (workspaceActive >= input.policy.limits.maxWorkspaceBrowserbaseActiveSessions) {
        return deny({
            reason: 'concurrency_limit',
            action: input.check.action,
            scope: 'workspace',
            scopeId: input.check.workspaceId,
            counterKey: 'browserbase_active_sessions',
            limit: input.policy.limits.maxWorkspaceBrowserbaseActiveSessions,
            requested: amountCount(input.check),
            current: workspaceActive,
        })
    }
    if (!input.check.roomId) {
        return null
    }
    const roomActive = await countActiveBrowserbaseSessions({
        env: input.check.env,
        workspaceId: input.check.workspaceId,
        roomId: input.check.roomId,
    })
    if (roomActive >= input.policy.limits.maxRoomBrowserbaseActiveSessions) {
        return deny({
            reason: 'concurrency_limit',
            action: input.check.action,
            scope: 'room',
            scopeId: input.check.roomId,
            counterKey: 'browserbase_active_sessions',
            limit: input.policy.limits.maxRoomBrowserbaseActiveSessions,
            requested: amountCount(input.check),
            current: roomActive,
        })
    }
    return null
}

async function storageDenial(input: {
    check: HostedQuotaCheckInput
    policy: HostedQuotaPolicy
}): Promise<HostedQuotaDenyDecision | null> {
    const bytes = amountBytes(input.check)
    if (
        bytes <= 0 ||
        (input.check.action !== 'file_upload' && input.check.action !== 'runtime_file_sync')
    ) {
        return null
    }
    const workspaceBytes = await storageBytes({
        env: input.check.env,
        workspaceId: input.check.workspaceId,
    })
    if (workspaceBytes + bytes > input.policy.limits.maxWorkspaceStorageBytes) {
        return deny({
            reason: 'storage_quota_exceeded',
            action: input.check.action,
            scope: 'workspace',
            scopeId: input.check.workspaceId,
            counterKey: 'storage_bytes',
            limit: input.policy.limits.maxWorkspaceStorageBytes,
            requested: bytes,
            current: workspaceBytes,
        })
    }
    if (!input.check.roomId) {
        return null
    }
    const roomBytes = await storageBytes({
        env: input.check.env,
        workspaceId: input.check.workspaceId,
        roomId: input.check.roomId,
    })
    if (roomBytes + bytes > input.policy.limits.maxRoomStorageBytes) {
        return deny({
            reason: 'storage_quota_exceeded',
            action: input.check.action,
            scope: 'room',
            scopeId: input.check.roomId,
            counterKey: 'storage_bytes',
            limit: input.policy.limits.maxRoomStorageBytes,
            requested: bytes,
            current: roomBytes,
        })
    }
    return null
}

async function counterDenial(input: {
    check: HostedQuotaCheckInput
    rules: CounterRule[]
}): Promise<HostedQuotaDenyDecision | null> {
    for (const rule of input.rules) {
        const current = await readCounter({
            env: input.check.env,
            rule,
        })
        if (current + rule.amount > rule.limit) {
            return deny({
                reason: rule.reason,
                action: input.check.action,
                scope: rule.scope,
                scopeId: rule.scopeId,
                counterKey: rule.counterKey,
                limit: rule.limit,
                requested: rule.amount,
                current,
            })
        }
    }
    return null
}

async function consumeCounters(input: {
    check: HostedQuotaCheckInput
    rules: CounterRule[]
    now: string
}): Promise<HostedQuotaDenyDecision | null> {
    for (const rule of input.rules) {
        const updated = await incrementCounter({
            env: input.check.env,
            rule,
            now: input.now,
        })
        if (!updated) {
            const current = await readCounter({
                env: input.check.env,
                rule,
            })
            return deny({
                reason: rule.reason,
                action: input.check.action,
                scope: rule.scope,
                scopeId: rule.scopeId,
                counterKey: rule.counterKey,
                limit: rule.limit,
                requested: rule.amount,
                current,
            })
        }
    }
    return null
}

async function recordQuotaEvent(input: {
    check: HostedQuotaCheckInput
    decision: HostedQuotaDenyDecision
    scopeHash: string
    now: string
}): Promise<void> {
    await input.check.env.AGENT_ROOM_DB.prepare(
        `
            INSERT INTO hosted_quota_event (
                id,
                workspace_id,
                actor_user_id,
                room_id,
                scope,
                scope_hash,
                action,
                decision,
                reason,
                quantity,
                metadata,
                created_at
            )
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 'denied', ?8, ?9, ?10, ?11)
        `,
    )
        .bind(
            crypto.randomUUID(),
            input.check.workspaceId,
            input.check.actorUserId ?? null,
            input.check.roomId ?? null,
            input.decision.scope,
            input.scopeHash,
            input.check.action,
            input.decision.reason,
            input.decision.requested,
            JSON.stringify({
                counterKey: input.decision.counterKey,
                limit: input.decision.limit,
                current: input.decision.current,
                providerPath: input.check.providerPath ?? null,
            }),
            input.now,
        )
        .run()
}

async function recordHostedQuotaDenied(input: {
    check: HostedQuotaCheckInput
    decision: HostedQuotaDenyDecision
    now: string
}): Promise<void> {
    const scopeHash = await hashScopeId(input.decision.scopeId)
    await Promise.allSettled([
        recordQuotaEvent({
            ...input,
            scopeHash,
        }),
        appendHostedAudit({
            env: input.check.env,
            workspaceId: input.check.workspaceId,
            actorUserId: input.check.actorUserId ?? null,
            roomId: input.check.roomId ?? null,
            action: 'hosted_quota.denied',
            payload: toJsonValue({
                quotaAction: input.check.action,
                reason: input.decision.reason,
                scope: input.decision.scope,
                scopeHash,
                counterKey: input.decision.counterKey,
                limit: input.decision.limit,
                requested: input.decision.requested,
                current: input.decision.current,
                provider: providerFromAction(input.check.action),
                providerPath: input.check.providerPath ?? null,
            }),
            now: new Date(input.now),
        }),
        appendHostedUsageEvent({
            env: input.check.env,
            workspaceId: input.check.workspaceId,
            roomId: input.check.roomId ?? null,
            sessionKey: input.check.sessionKey ?? null,
            runId: input.check.runId ?? null,
            jobId: input.check.jobId ?? null,
            kind: usageKindForAction(input.check.action),
            provider: providerFromAction(input.check.action),
            model: null,
            toolName: input.check.action,
            inputTokens: null,
            outputTokens: null,
            cachedTokens: null,
            reasoningTokens: null,
            totalTokens: null,
            durationMs: null,
            activeDurationMs: null,
            idleDurationMs: null,
            estimatedCostUsd: null,
            costMicros: null,
            billingStatus: 'blocked',
            metadata: {
                quotaDenied: true,
                quotaAction: input.check.action,
                reason: input.decision.reason,
                scope: input.decision.scope,
                scopeHash,
                counterKey: input.decision.counterKey,
                providerPath: input.check.providerPath ?? null,
            },
            idempotencyKey: null,
            now: new Date(input.now),
        }),
    ])
}

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
