import type { AgentRoomHostedEnv } from './bindings'
import type { RuntimeUsageEventInsert } from '../rooms/pi-execution-adapter/usage-sync'
import type { HostedProviderCandidate } from './hosted-room-service'
import {
    appendHostedUsageEvent,
    debitHostedBalance,
    ensureHostedBillingAccount,
    findHostedBillingReservationById,
    readHostedBillingAccount,
    releaseHostedBillingReservation,
    releaseExpiredHostedBillingReservations,
} from './hosted-billing-repository'
import {
    applyUsageMarkupMicros,
    centsFromMicrosCeil,
    hostedBillingLedgerSourceForProvider,
    hostedProviderBillingGateCents,
    type HostedBillingReservationProvider,
} from './hosted-billing-types'
import { resolveHostedConfig } from './hosted-config'
import { nowIso } from './hosted-json'

export interface HostedProviderUsageInput {
    env: AgentRoomHostedEnv
    workspaceId: string
    roomId: string | null
    sessionKey: string | null
    runId: string | null
    jobId: string | null
    provider: HostedBillingReservationProvider
    model: string | null
    inputTokens: number | null
    outputTokens: number | null
    cachedTokens: number | null
    reasoningTokens?: number | null
    totalTokens?: number | null
    durationMs?: number | null
    activeDurationMs?: number | null
    idleDurationMs?: number | null
    estimatedCostUsd?: number | null
    metadata?: Record<string, unknown>
    idempotencyKey?: string | null
    costMicros: number
    billingReservationId?: string | null
    now?: Date
}

export async function assertHostedProviderCreditsAvailable(input: {
    env: AgentRoomHostedEnv
    workspaceId: string
    now?: Date
}): Promise<void> {
    await ensureHostedBillingAccount({
        env: input.env,
        workspaceId: input.workspaceId,
    })
    await releaseExpiredHostedBillingReservations({
        env: input.env,
        workspaceId: input.workspaceId,
        now: input.now,
    })
    const account = await readHostedBillingAccount(input)
    if (account.availableBalanceCents < hostedProviderBillingGateCents) {
        throw new Error('Hosted billing balance is exhausted')
    }
}

export async function recordHostedProviderUsage(input: HostedProviderUsageInput): Promise<{
    usageEventId: string
    debitedCents: number
    ledgerEntryId: string | null
}> {
    const config = resolveHostedConfig(input.env)
    await ensureHostedBillingAccount({
        env: input.env,
        workspaceId: input.workspaceId,
    })
    const now = nowIso(input.now)
    const billingReservation =
        input.billingReservationId === undefined || input.billingReservationId === null
            ? null
            : await findHostedBillingReservationById({
                  env: input.env,
                  workspaceId: input.workspaceId,
                  reservationId: input.billingReservationId,
              })
    const activeBillingReservation =
        billingReservation &&
        billingReservation.status === 'authorized' &&
        billingReservation.provider === input.provider &&
        billingReservation.roomId === input.roomId &&
        billingReservation.expiresAt > now
            ? billingReservation
            : null
    const markupBps = config.billing.usageMarkupBps
    const billedMicros = applyUsageMarkupMicros(input.costMicros, markupBps)
    const amountCents = centsFromMicrosCeil(billedMicros)
    const usageEventId = await appendHostedUsageEvent({
        env: input.env,
        workspaceId: input.workspaceId,
        roomId: input.roomId,
        sessionKey: input.sessionKey,
        runId: input.runId,
        jobId: input.jobId,
        kind: 'provider',
        provider: input.provider,
        model: input.model,
        toolName: null,
        inputTokens: input.inputTokens,
        outputTokens: input.outputTokens,
        cachedTokens: input.cachedTokens,
        reasoningTokens: input.reasoningTokens ?? null,
        totalTokens: input.totalTokens ?? null,
        durationMs: input.durationMs ?? null,
        activeDurationMs: input.activeDurationMs ?? null,
        idleDurationMs: input.idleDurationMs ?? null,
        estimatedCostUsd:
            input.estimatedCostUsd === undefined || input.estimatedCostUsd === null
                ? null
                : String(input.estimatedCostUsd),
        costMicros: input.costMicros,
        billingStatus: amountCents > 0 ? 'pending' : 'not_billable',
        metadata: input.metadata,
        idempotencyKey: input.idempotencyKey,
        now: input.now,
    })
    if (amountCents === 0) {
        if (activeBillingReservation) {
            await releaseHostedBillingReservation({
                env: input.env,
                workspaceId: input.workspaceId,
                reservationId: activeBillingReservation.id,
                now: input.now,
            })
        }
        return {
            usageEventId,
            debitedCents: 0,
            ledgerEntryId: null,
        }
    }
    let ledger: Awaited<ReturnType<typeof debitHostedBalance>>
    try {
        ledger = await debitHostedBalance({
            env: input.env,
            workspaceId: input.workspaceId,
            source: hostedBillingLedgerSourceForProvider(input.provider),
            amountCents,
            usageEventId,
            idempotencyKey: `hosted_usage:${usageEventId}`,
            reservedDraw: activeBillingReservation
                ? {
                      includedCents: activeBillingReservation.includedReservedCents,
                      purchasedCents: activeBillingReservation.purchasedReservedCents,
                  }
                : undefined,
            settleReservation: activeBillingReservation
                ? {
                      reservationId: activeBillingReservation.id,
                      reservedCents: activeBillingReservation.reservedCents,
                      includedReservedCents: activeBillingReservation.includedReservedCents,
                      purchasedReservedCents: activeBillingReservation.purchasedReservedCents,
                      settledCents: amountCents,
                  }
                : undefined,
            metadata: {
                provider: input.provider,
                model: input.model,
                costMicros: input.costMicros,
                markupBps,
                billedMicros,
                ...(activeBillingReservation ? { reservationId: activeBillingReservation.id } : {}),
            },
            now: input.now,
        })
    } catch (error) {
        if (activeBillingReservation) {
            await releaseHostedBillingReservation({
                env: input.env,
                workspaceId: input.workspaceId,
                reservationId: activeBillingReservation.id,
                now: input.now,
            })
        }
        throw error
    }
    return {
        usageEventId,
        debitedCents: amountCents,
        ledgerEntryId: ledger.id,
    }
}

export async function recordHostedProviderUsageBlocked(input: {
    env: AgentRoomHostedEnv
    workspaceId: string
    roomId: string | null
    sessionKey: string | null
    runId: string | null
    jobId: string | null
    provider: HostedBillingReservationProvider
    model: string | null
    metadata: Record<string, unknown>
    idempotencyKey: string
    now?: Date
}): Promise<string> {
    await ensureHostedBillingAccount({
        env: input.env,
        workspaceId: input.workspaceId,
    })
    return appendHostedUsageEvent({
        env: input.env,
        workspaceId: input.workspaceId,
        roomId: input.roomId,
        sessionKey: input.sessionKey,
        runId: input.runId,
        jobId: input.jobId,
        kind: 'provider',
        provider: input.provider,
        model: input.model,
        toolName: null,
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
        metadata: input.metadata,
        idempotencyKey: input.idempotencyKey,
        now: input.now,
    })
}

function metadataRecord(value: RuntimeUsageEventInsert['metadata']): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : {}
}

function isManagedOpenRouterBillableKind(event: RuntimeUsageEventInsert): boolean {
    return event.kind === 'provider' || event.kind === 'run' || event.kind === 'job'
}

function isManagedOpenRouterUsage(input: {
    event: RuntimeUsageEventInsert
    providerCandidate: HostedProviderCandidate
}): boolean {
    return (
        input.providerCandidate === 'hosted_openrouter' &&
        isManagedOpenRouterBillableKind(input.event)
    )
}

async function appendRuntimeUsageEvent(input: {
    env: AgentRoomHostedEnv
    workspaceId: string
    providerCandidate: HostedProviderCandidate
    event: RuntimeUsageEventInsert
    costMicros: number | null
    billingStatus: 'not_billable' | 'pending' | 'blocked'
    idempotencyKey: string
    now?: Date
}): Promise<string> {
    const metadata = {
        ...metadataRecord(input.event.metadata),
        providerCandidate: input.providerCandidate,
    }
    return appendHostedUsageEvent({
        env: input.env,
        workspaceId: input.workspaceId,
        roomId: input.event.roomId,
        sessionKey: input.event.sessionKey,
        runId: input.event.runId,
        jobId: input.event.jobId,
        kind: input.event.kind,
        provider: input.event.provider,
        model: input.event.model,
        toolName: input.event.toolName,
        inputTokens: input.event.inputTokens,
        outputTokens: input.event.outputTokens,
        cachedTokens: input.event.cachedTokens,
        reasoningTokens: input.event.reasoningTokens,
        totalTokens: input.event.totalTokens,
        durationMs: input.event.durationMs,
        activeDurationMs: input.event.activeDurationMs,
        idleDurationMs: input.event.idleDurationMs,
        estimatedCostUsd:
            input.event.estimatedCostUsd === null ? null : String(input.event.estimatedCostUsd),
        costMicros: input.costMicros,
        billingStatus: input.billingStatus,
        metadata,
        idempotencyKey: input.idempotencyKey,
        now: input.now,
    })
}

export async function recordHostedRuntimeUsageEvent(input: {
    env: AgentRoomHostedEnv
    workspaceId: string
    providerCandidate: HostedProviderCandidate
    event: RuntimeUsageEventInsert
    idempotencyKey: string
    now?: Date
}): Promise<{
    usageEventId: string
    persisted: boolean
    debitedCents: number
    ledgerEntryId: string | null
}> {
    if (isManagedOpenRouterUsage(input)) {
        const usageEventId = await appendRuntimeUsageEvent({
            env: input.env,
            workspaceId: input.workspaceId,
            providerCandidate: input.providerCandidate,
            event: {
                ...input.event,
                estimatedCostUsd: null,
                metadata: {
                    ...metadataRecord(input.event.metadata),
                    providerProxyBillingAuthority: 'worker_proxy',
                    runtimeCallbackBilling: 'telemetry_only',
                },
            },
            costMicros: null,
            billingStatus: 'not_billable',
            idempotencyKey: input.idempotencyKey,
            now: input.now,
        })
        return {
            usageEventId,
            persisted: true,
            debitedCents: 0,
            ledgerEntryId: null,
        }
    }
    const usageEventId = await appendRuntimeUsageEvent({
        env: input.env,
        workspaceId: input.workspaceId,
        providerCandidate: input.providerCandidate,
        event: input.event,
        costMicros: null,
        billingStatus: 'not_billable',
        idempotencyKey: input.idempotencyKey,
        now: input.now,
    })
    return {
        usageEventId,
        persisted: true,
        debitedCents: 0,
        ledgerEntryId: null,
    }
}
