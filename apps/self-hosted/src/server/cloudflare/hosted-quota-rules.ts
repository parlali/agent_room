import type { CounterRule, HostedQuotaCheckInput, HostedQuotaPolicy } from './hosted-quota-contract'

function safeIntegerAmount(value: number | undefined, fallback: number): number {
    if (value === undefined) {
        return fallback
    }
    return Number.isSafeInteger(value) && value >= 0 ? value : fallback
}

export function amountCount(input: HostedQuotaCheckInput): number {
    return safeIntegerAmount(input.amount?.count, 1)
}

export function amountBytes(input: HostedQuotaCheckInput): number {
    return safeIntegerAmount(input.amount?.bytes, 0)
}

function amountStorageBytes(input: HostedQuotaCheckInput): number {
    return safeIntegerAmount(input.amount?.storageBytes, amountBytes(input))
}

function amountCents(input: HostedQuotaCheckInput): number {
    return safeIntegerAmount(input.amount?.cents, 0)
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

export async function hashScopeId(value: string): Promise<string> {
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

export async function ipScopeId(request: Request | null | undefined): Promise<string> {
    const ip = requestIp(request)
    return ip ? `ip_${(await hashScopeId(ip)).slice(0, 40)}` : 'ip_unknown'
}

export function counterRules(input: {
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
