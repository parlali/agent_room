import type { RunBudgetConfig } from '../domain/types'

export type RunKind = 'manual' | 'scheduled' | 'subagent' | 'maintenance'
export type TimeoutReason =
    | 'idle_timeout'
    | 'total_run_budget'
    | 'provider_timeout'
    | 'command_timeout'
    | 'worker_timeout'
    | 'explicit_abort'

export interface RunBudgetSelection {
    runBudgetMs: number
    idleTimeoutMs: number
    providerIdleTimeoutMs: number
}

export interface RunHeartbeatRecord {
    runId: string
    runKind: RunKind
    startedAt: number
    heartbeatAt: number
    lastReason: string
    totalBudgetExpiresAt: number
    idleTimeoutExpiresAt: number
}

export function budgetForRunKind(config: RunBudgetConfig, kind: RunKind): RunBudgetSelection {
    const runBudgetMs =
        kind === 'scheduled'
            ? config.scheduledTurnMs
            : kind === 'subagent'
              ? config.subagentTurnMs
              : kind === 'maintenance'
                ? config.maintenanceTurnMs
                : config.manualTurnMs
    return {
        runBudgetMs,
        idleTimeoutMs: config.idleTimeoutMs,
        providerIdleTimeoutMs: config.providerIdleTimeoutMs,
    }
}

export class RunWatchdog extends Error {
    readonly reason: TimeoutReason

    constructor(reason: TimeoutReason, message: string) {
        super(message)
        this.reason = reason
    }
}

export function createRunHeartbeat(input: {
    runId: string
    runKind: RunKind
    budget: RunBudgetSelection
    now?: number
}): RunHeartbeatRecord {
    const now = input.now ?? Date.now()
    return {
        runId: input.runId,
        runKind: input.runKind,
        startedAt: now,
        heartbeatAt: now,
        lastReason: 'run_started',
        totalBudgetExpiresAt: now + input.budget.runBudgetMs,
        idleTimeoutExpiresAt: now + input.budget.idleTimeoutMs,
    }
}

export function touchRunHeartbeat(input: {
    record: RunHeartbeatRecord
    budget: RunBudgetSelection
    reason: string
    now?: number
}): RunHeartbeatRecord {
    const now = input.now ?? Date.now()
    return {
        ...input.record,
        heartbeatAt: now,
        lastReason: input.reason,
        idleTimeoutExpiresAt: now + input.budget.idleTimeoutMs,
    }
}

export function timeoutReasonForHeartbeat(input: {
    record: RunHeartbeatRecord
    now?: number
}): TimeoutReason | null {
    const now = input.now ?? Date.now()
    if (now >= input.record.totalBudgetExpiresAt) {
        return 'total_run_budget'
    }
    if (now >= input.record.idleTimeoutExpiresAt) {
        return 'idle_timeout'
    }
    return null
}

export function timeoutMessage(reason: TimeoutReason): string {
    if (reason === 'idle_timeout') {
        return 'Run stopped because no model, tool, command, or worker progress arrived before the idle timeout'
    }
    if (reason === 'total_run_budget') {
        return 'Run stopped because its total run budget expired'
    }
    if (reason === 'provider_timeout') {
        return 'Run stopped because the provider stream timed out'
    }
    if (reason === 'command_timeout') {
        return 'Command stopped because its command timeout expired'
    }
    if (reason === 'worker_timeout') {
        return 'Worker stopped because its worker timeout expired'
    }
    return 'Run stopped because it was explicitly aborted'
}
