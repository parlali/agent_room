import { describe, expect, it } from 'vitest'
import {
    budgetForRunKind,
    createRunHeartbeat,
    timeoutMessage,
    timeoutReasonForHeartbeat,
    touchRunHeartbeat,
} from './run-budget'
import type { RunBudgetConfig } from '../domain/types'

const budgets: RunBudgetConfig = {
    manualTurnMs: 8 * 60 * 60 * 1000,
    scheduledTurnMs: 6 * 60 * 60 * 1000,
    subagentTurnMs: 2 * 60 * 60 * 1000,
    maintenanceTurnMs: 30 * 60 * 1000,
    idleTimeoutMs: 5 * 60 * 1000,
    providerIdleTimeoutMs: 2 * 60 * 1000,
    shellCommandMs: 4 * 60 * 60 * 1000,
    webFetchMs: 30 * 1000,
    documentWorkerMs: 20 * 60 * 1000,
    imageGenerationMs: 5 * 60 * 1000,
    mcpToolMs: 2 * 60 * 1000,
    shortCommandWaitMs: 5000,
}

describe('run budgets', () => {
    it('keeps provider idle timeout separate from total run budget', () => {
        expect(budgetForRunKind(budgets, 'manual')).toEqual({
            runBudgetMs: budgets.manualTurnMs,
            idleTimeoutMs: budgets.idleTimeoutMs,
            providerIdleTimeoutMs: budgets.providerIdleTimeoutMs,
        })
        expect(budgetForRunKind(budgets, 'scheduled').runBudgetMs).toBe(budgets.scheduledTurnMs)
        expect(budgetForRunKind(budgets, 'subagent').runBudgetMs).toBe(budgets.subagentTurnMs)
    })

    it('distinguishes idle timeout from total budget expiry', () => {
        const budget = budgetForRunKind(budgets, 'manual')
        const heartbeat = createRunHeartbeat({
            runId: 'run-1',
            runKind: 'manual',
            budget,
            now: 1_000,
        })

        expect(timeoutReasonForHeartbeat({ record: heartbeat, now: 1_000 + 60_000 })).toBeNull()
        expect(
            timeoutReasonForHeartbeat({
                record: heartbeat,
                now: 1_000 + budgets.idleTimeoutMs,
            }),
        ).toBe('idle_timeout')
        expect(
            timeoutReasonForHeartbeat({
                record: heartbeat,
                now: 1_000 + budgets.manualTurnMs,
            }),
        ).toBe('total_run_budget')
    })

    it('heartbeats extend idle timeout but not total run budget', () => {
        const budget = budgetForRunKind(budgets, 'manual')
        const heartbeat = createRunHeartbeat({
            runId: 'run-1',
            runKind: 'manual',
            budget,
            now: 1_000,
        })
        const touched = touchRunHeartbeat({
            record: heartbeat,
            budget,
            reason: 'tool_progress',
            now: 1_000 + 240_000,
        })

        expect(touched.totalBudgetExpiresAt).toBe(heartbeat.totalBudgetExpiresAt)
        expect(touched.idleTimeoutExpiresAt).toBe(1_000 + 240_000 + budgets.idleTimeoutMs)
        expect(
            timeoutReasonForHeartbeat({
                record: touched,
                now: 1_000 + 240_000 + budgets.idleTimeoutMs - 1,
            }),
        ).toBeNull()
    })

    it('uses explicit timeout messages', () => {
        expect(timeoutMessage('explicit_abort')).toContain('explicitly aborted')
        expect(timeoutMessage('command_timeout')).toContain('command timeout')
        expect(timeoutMessage('worker_timeout')).toContain('worker timeout')
    })
})
