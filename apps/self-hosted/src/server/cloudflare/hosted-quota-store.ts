import { appendHostedAudit } from './hosted-audit'
import { appendHostedUsageEvent } from './hosted-billing-usage-repository'
import type { HostedBillingReservationProvider } from './hosted-billing-types'
import { toJsonValue } from './hosted-json'
import {
    deny,
    type CounterRule,
    type HostedQuotaAction,
    type HostedQuotaCheckInput,
    type HostedQuotaDenyDecision,
    type HostedQuotaPolicy,
} from './hosted-quota-contract'
import { amountBytes, amountCount, hashScopeId } from './hosted-quota-rules'

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

async function readCounter(input: {
    check: HostedQuotaCheckInput
    rule: CounterRule
}): Promise<number> {
    const row = await input.check.env.AGENT_ROOM_DB.prepare(
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

function counterRuleValuesSql(rules: CounterRule[]): string {
    return rules
        .map((_, index) => {
            const offset = index * 7
            return `(?${offset + 1}, ?${offset + 2}, ?${offset + 3}, ?${offset + 4}, ?${offset + 5}, ?${offset + 6}, ?${offset + 7})`
        })
        .join(', ')
}

function counterRuleValues(rule: CounterRule, now: string): unknown[] {
    return [rule.scope, rule.scopeId, rule.windowKey, rule.counterKey, rule.amount, now, rule.limit]
}

async function incrementCounters(input: {
    check: HostedQuotaCheckInput
    rules: CounterRule[]
    now: string
}): Promise<boolean> {
    if (input.rules.length === 0) {
        return true
    }
    const result = await input.check.env.AGENT_ROOM_DB.prepare(
        `
            WITH increments(
                scope,
                scope_id,
                window_key,
                counter_key,
                quantity,
                updated_at,
                limit_value
            ) AS (
                VALUES ${counterRuleValuesSql(input.rules)}
            ),
            allowed AS (
                SELECT COUNT(*) AS allowed_count
                FROM increments
                LEFT JOIN hosted_quota_counter existing
                  ON existing.scope = increments.scope
                 AND existing.scope_id = increments.scope_id
                 AND existing.window_key = increments.window_key
                 AND existing.counter_key = increments.counter_key
                WHERE increments.quantity <= increments.limit_value
                  AND COALESCE(existing.quantity, 0) + increments.quantity <= increments.limit_value
            ),
            required AS (
                SELECT COUNT(*) AS required_count
                FROM increments
            )
            INSERT INTO hosted_quota_counter (
                scope,
                scope_id,
                window_key,
                counter_key,
                quantity,
                updated_at
            )
            SELECT scope,
                   scope_id,
                   window_key,
                   counter_key,
                   quantity,
                   updated_at
            FROM increments
            WHERE (SELECT allowed_count FROM allowed) = (SELECT required_count FROM required)
            ON CONFLICT(scope, scope_id, window_key, counter_key) DO UPDATE SET
                quantity = hosted_quota_counter.quantity + excluded.quantity,
                updated_at = excluded.updated_at
            WHERE (SELECT allowed_count FROM allowed) = (SELECT required_count FROM required)
        `,
    )
        .bind(...input.rules.flatMap((rule) => counterRuleValues(rule, input.now)))
        .run()
    return (result.meta.changes ?? 0) > 0
}

async function countActiveBrowserbaseSessions(input: {
    check: HostedQuotaCheckInput
    roomId?: string | null
}): Promise<number> {
    const row = input.roomId
        ? await input.check.env.AGENT_ROOM_DB.prepare(
              `
                  SELECT COUNT(*) AS activeCount
                  FROM hosted_browserbase_session
                  WHERE workspace_id = ?1
                    AND room_id = ?2
                    AND status IN ('active', 'release_requested')
              `,
          )
              .bind(input.check.workspaceId, input.roomId)
              .first<{ activeCount: number }>()
        : await input.check.env.AGENT_ROOM_DB.prepare(
              `
                  SELECT COUNT(*) AS activeCount
                  FROM hosted_browserbase_session
                  WHERE workspace_id = ?1
                    AND status IN ('active', 'release_requested')
              `,
          )
              .bind(input.check.workspaceId)
              .first<{ activeCount: number }>()
    return row?.activeCount ?? 0
}

async function storageBytes(input: {
    check: HostedQuotaCheckInput
    roomId?: string | null
}): Promise<number> {
    const row = input.roomId
        ? await input.check.env.AGENT_ROOM_DB.prepare(
              `
                  SELECT COALESCE(SUM(byte_length), 0) AS byteLength
                  FROM hosted_room_file_index
                  WHERE workspace_id = ?1
                    AND room_id = ?2
                    AND kind = 'file'
              `,
          )
              .bind(input.check.workspaceId, input.roomId)
              .first<{ byteLength: number }>()
        : await input.check.env.AGENT_ROOM_DB.prepare(
              `
                  SELECT COALESCE(SUM(byte_length), 0) AS byteLength
                  FROM hosted_room_file_index
                  WHERE workspace_id = ?1
                    AND kind = 'file'
              `,
          )
              .bind(input.check.workspaceId)
              .first<{ byteLength: number }>()
    return Number(row?.byteLength ?? 0)
}

export async function activeConcurrencyDenial(input: {
    check: HostedQuotaCheckInput
    policy: HostedQuotaPolicy
}): Promise<HostedQuotaDenyDecision | null> {
    if (input.check.action !== 'browserbase_session_start') {
        return null
    }
    const workspaceActive = await countActiveBrowserbaseSessions({
        check: input.check,
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
        check: input.check,
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

export async function storageDenial(input: {
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
        check: input.check,
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
        check: input.check,
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

export async function counterDenial(input: {
    check: HostedQuotaCheckInput
    rules: CounterRule[]
}): Promise<HostedQuotaDenyDecision | null> {
    for (const rule of input.rules) {
        const current = await readCounter({
            check: input.check,
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

export async function consumeCounters(input: {
    check: HostedQuotaCheckInput
    rules: CounterRule[]
    now: string
}): Promise<HostedQuotaDenyDecision | null> {
    const updated = await incrementCounters(input)
    if (updated) {
        return null
    }
    const denial = await counterDenial({
        check: input.check,
        rules: input.rules,
    })
    return (
        denial ??
        deny({
            reason: 'quota_unavailable',
            action: input.check.action,
            scope: 'workspace',
            scopeId: input.check.workspaceId,
            counterKey: input.check.action,
            limit: null,
            requested: null,
            current: null,
        })
    )
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

export async function recordHostedQuotaDenied(input: {
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
