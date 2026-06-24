import type { AgentSession, SessionEntry } from '@mariozechner/pi-coding-agent'

export type RunUsageDelta = {
    inputTokens: number | null
    outputTokens: number | null
    cachedTokens: number | null
    reasoningTokens: number | null
    totalTokens: number | null
    estimatedCostUsd: number | null
    costKnown: boolean
}

export type SessionUsageSnapshot = {
    inputTokens: number
    outputTokens: number
    cacheReadTokens: number
    cacheWriteTokens: number
    reasoningTokens: number
    totalTokens: number
    estimatedCostUsd: number
    usageEntryCount: number
}

function emptyDelta(costKnown: boolean): RunUsageDelta {
    return {
        inputTokens: null,
        outputTokens: null,
        cachedTokens: null,
        reasoningTokens: null,
        totalTokens: null,
        estimatedCostUsd: null,
        costKnown,
    }
}

function record(value: unknown): Record<string, unknown> | null {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : null
}

function finiteNumber(value: unknown): number {
    return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function assistantUsage(message: unknown): Record<string, unknown> | null {
    const messageRecord = record(message)
    if (!messageRecord || messageRecord.role !== 'assistant') return null
    return record(messageRecord.usage)
}

function addUsage(snapshot: SessionUsageSnapshot, usage: Record<string, unknown>): void {
    const inputTokens = finiteNumber(usage.input)
    const outputTokens = finiteNumber(usage.output)
    const cacheReadTokens = finiteNumber(usage.cacheRead)
    const cacheWriteTokens = finiteNumber(usage.cacheWrite)
    const reasoningTokens = finiteNumber(usage.reasoningTokens)
    const fallbackTotal =
        inputTokens + outputTokens + cacheReadTokens + cacheWriteTokens + reasoningTokens
    const totalTokens = finiteNumber(usage.totalTokens) || fallbackTotal
    const cost = record(usage.cost)

    snapshot.inputTokens += inputTokens
    snapshot.outputTokens += outputTokens
    snapshot.cacheReadTokens += cacheReadTokens
    snapshot.cacheWriteTokens += cacheWriteTokens
    snapshot.reasoningTokens += reasoningTokens
    snapshot.totalTokens += totalTokens
    snapshot.estimatedCostUsd += finiteNumber(cost?.total)
    snapshot.usageEntryCount += 1
}

function snapshotFromMessages(messages: readonly unknown[]): SessionUsageSnapshot | null {
    const snapshot: SessionUsageSnapshot = {
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        reasoningTokens: 0,
        totalTokens: 0,
        estimatedCostUsd: 0,
        usageEntryCount: 0,
    }

    for (const message of messages) {
        const usage = assistantUsage(message)
        if (usage) {
            addUsage(snapshot, usage)
        }
    }

    return snapshot.usageEntryCount > 0 ? snapshot : null
}

export function sessionUsageSnapshotFromEntries(
    entries: readonly SessionEntry[],
): SessionUsageSnapshot | null {
    const messages = entries
        .filter((entry) => entry.type === 'message')
        .map((entry) => entry.message)
    return snapshotFromMessages(messages)
}

export function sessionUsageSnapshot(session: AgentSession): SessionUsageSnapshot | null {
    const entrySnapshot = sessionUsageSnapshotFromEntries(session.sessionManager.getEntries())
    if (entrySnapshot) return entrySnapshot
    return snapshotFromMessages(session.messages)
}

function nonNegativeDelta(after: number, before: number): number {
    if (!Number.isFinite(after) || !Number.isFinite(before)) return 0
    return Math.max(0, after - before)
}

export function sessionUsageDelta(
    before: SessionUsageSnapshot | null,
    after: SessionUsageSnapshot | null,
    costKnown: boolean,
): RunUsageDelta {
    if (!after) return emptyDelta(costKnown)

    const baseline = before ?? {
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        reasoningTokens: 0,
        totalTokens: 0,
        estimatedCostUsd: 0,
        usageEntryCount: 0,
    }
    const inputTokens = nonNegativeDelta(after.inputTokens, baseline.inputTokens)
    const outputTokens = nonNegativeDelta(after.outputTokens, baseline.outputTokens)
    const cachedTokens =
        nonNegativeDelta(after.cacheReadTokens, baseline.cacheReadTokens) +
        nonNegativeDelta(after.cacheWriteTokens, baseline.cacheWriteTokens)
    const reasoningTokens = nonNegativeDelta(after.reasoningTokens, baseline.reasoningTokens)
    const totalTokens = nonNegativeDelta(after.totalTokens, baseline.totalTokens)
    const estimatedCostUsd = costKnown
        ? nonNegativeDelta(after.estimatedCostUsd, baseline.estimatedCostUsd)
        : null

    return {
        inputTokens,
        outputTokens,
        cachedTokens,
        reasoningTokens: reasoningTokens > 0 ? reasoningTokens : null,
        totalTokens,
        estimatedCostUsd,
        costKnown,
    }
}

export function sessionModelCostKnown(session: AgentSession): boolean {
    const cost = session.state.model?.cost
    if (!cost) return false
    return [cost.input, cost.output, cost.cacheRead, cost.cacheWrite].some(
        (value) => Number.isFinite(value) && value > 0,
    )
}

export function runUsageDeltaWithActualCostMicros(
    usage: RunUsageDelta,
    costMicros: number | null,
): RunUsageDelta {
    if (costMicros === null) {
        return usage
    }
    return {
        ...usage,
        estimatedCostUsd: costMicros / 1_000_000,
        costKnown: true,
    }
}
