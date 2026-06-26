import type { JsonValue } from '#/domain/domain-types'
import type { AgentRoomHostedEnv } from './bindings'
import { resolveHostedConfig } from './hosted-config'
import { objectRecord, parseJsonValue } from './hosted-json'
import {
    deny,
    hostedQuotaActions,
    type HostedQuotaAction,
    type HostedQuotaCapability,
    type HostedQuotaCheckInput,
    type HostedQuotaDenyDecision,
    type HostedQuotaLimits,
    type HostedQuotaPolicy,
    type HostedQuotaRestrictions,
} from './hosted-quota-contract'

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

function isHostedQuotaAction(value: string): value is HostedQuotaAction {
    return hostedQuotaActions.includes(value as HostedQuotaAction)
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

export async function readHostedQuotaPolicy(input: {
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

export function restrictedByPolicy(input: {
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
