import { Buffer } from 'node:buffer'
import type { AgentRoomHostedEnv } from './bindings'
import {
    assertHostedQuotaAllowed,
    hostedQuotaDeniedResponse,
    parseHostedQuotaAction,
    type HostedQuotaAmount,
} from './hosted-abuse-controls'
import { upsertHostedRoomRuntimeFile } from './hosted-file-store'
import { objectRecord } from './hosted-json'
import {
    deleteHostedRuntimeStateFile,
    putHostedRuntimeStateFile,
} from './hosted-runtime-state-store'
import { requireHostedRuntimeCallback } from './hosted-runtime-worker-auth'
import { recordHostedRuntimeUsageEvent } from './hosted-usage-billing'
import { hostedJsonResponse } from './hosted-worker-response'
import { parseHostedRuntimeStateOperation } from '../rooms/hosted-runtime-state-contract'
import { runtimeUsageEventFromLogEntry } from '../rooms/pi-execution-adapter/usage-sync'
import type { RoomFileSurface } from '../rooms/file-store'

function quotaAmount(value: unknown): HostedQuotaAmount {
    const amount = objectRecord(value)
    return {
        count: finiteWholeNumber(amount.count),
        bytes: finiteWholeNumber(amount.bytes),
        storageBytes: finiteWholeNumber(amount.storageBytes),
        cents: finiteWholeNumber(amount.cents),
    }
}

function finiteWholeNumber(value: unknown): number | undefined {
    return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
        ? value
        : undefined
}

export function runtimeUsageIdempotencyKey(input: {
    workspaceId: string
    roomId: string
    entry: unknown
}): string {
    const entry = objectRecord(input.entry)
    const seq = typeof entry.seq === 'number' && Number.isFinite(entry.seq) ? entry.seq : null
    const ts = typeof entry.ts === 'number' && Number.isFinite(entry.ts) ? entry.ts : null
    const event = idempotencyField(typeof entry.event === 'string' ? entry.event : 'unknown')
    if (seq !== null && ts !== null) {
        return `runtime:${input.workspaceId}:${input.roomId}:${ts}:${seq}:${event}`
    }
    const payload = objectRecord(entry.payload)
    const stableFields = [
        ts === null ? 'no-ts' : String(ts),
        event,
        idempotencyField(entry.sessionKey ?? payload.sessionKey),
        idempotencyField(entry.runId ?? payload.runId),
        idempotencyField(entry.jobId ?? payload.jobId),
    ].join('\u0000')
    return `runtime:${input.workspaceId}:${input.roomId}:${event}:missing-seq:${stableHash(stableFields)}`
}

function idempotencyField(value: unknown): string {
    return typeof value === 'string' && value.trim()
        ? value
              .trim()
              .replace(/[^a-zA-Z0-9_.:-]/g, '_')
              .slice(0, 128)
        : 'none'
}

function stableHash(value: string): string {
    let hash = 2166136261
    for (let index = 0; index < value.length; index += 1) {
        hash ^= value.charCodeAt(index)
        hash = Math.imul(hash, 16777619)
    }
    return (hash >>> 0).toString(36)
}

export async function hostedRuntimeUsageCallback(
    env: AgentRoomHostedEnv,
    request: Request,
): Promise<Response> {
    let record: Record<string, unknown> = {}
    try {
        const body = (await request.json()) as unknown
        record = body && typeof body === 'object' ? (body as Record<string, unknown>) : {}
    } catch {
        return hostedJsonResponse(
            {
                ok: false,
                code: 'invalid_request_body',
            },
            {
                status: 400,
            },
        )
    }
    const callback = await requireHostedRuntimeCallback({
        env,
        request,
        record,
    })
    if (callback instanceof Response) {
        return callback
    }
    const providerCandidate = callback.runtime.runtime.providerCandidate
    if (!providerCandidate) {
        return hostedJsonResponse(
            {
                ok: false,
                code: 'runtime_provider_binding_missing',
            },
            {
                status: 409,
            },
        )
    }
    const event = runtimeUsageEventFromLogEntry({
        roomId: callback.roomId,
        entry: record.entry,
    })
    if (!event) {
        return hostedJsonResponse({
            ok: true,
            persisted: false,
        })
    }
    const result = await recordHostedRuntimeUsageEvent({
        env,
        workspaceId: callback.workspaceId,
        providerCandidate,
        event,
        idempotencyKey: runtimeUsageIdempotencyKey({
            workspaceId: callback.workspaceId,
            roomId: callback.roomId,
            entry: record.entry,
        }),
    })
    return hostedJsonResponse({
        ok: true,
        persisted: result.persisted,
        id: result.usageEventId,
        debitedCents: result.debitedCents,
        ledgerEntryId: result.ledgerEntryId,
    })
}

function runtimeFileSurface(value: unknown): RoomFileSurface | null {
    return value === 'workspace' || value === 'store' ? value : null
}

export async function hostedRuntimeFileCallback(
    env: AgentRoomHostedEnv,
    request: Request,
): Promise<Response> {
    let record: Record<string, unknown> = {}
    try {
        const body = (await request.json()) as unknown
        record = body && typeof body === 'object' ? (body as Record<string, unknown>) : {}
    } catch {
        return hostedJsonResponse(
            {
                ok: false,
                code: 'invalid_request_body',
            },
            {
                status: 400,
            },
        )
    }
    const callback = await requireHostedRuntimeCallback({
        env,
        request,
        record,
    })
    if (callback instanceof Response) {
        return callback
    }
    const file = objectRecord(record.file)
    const surface = runtimeFileSurface(file.surface)
    const relativePath = typeof file.relativePath === 'string' ? file.relativePath : ''
    if (!surface || !relativePath || typeof file.contentBase64 !== 'string') {
        return hostedJsonResponse(
            {
                ok: false,
                code: 'invalid_file_callback',
                message: 'surface, relativePath, and contentBase64 are required',
            },
            {
                status: 400,
            },
        )
    }
    const saved = await upsertHostedRoomRuntimeFile({
        env,
        workspaceId: callback.workspaceId,
        roomId: callback.roomId,
        surface,
        relativePath,
        content: new Uint8Array(Buffer.from(file.contentBase64, 'base64url')),
    })
    return hostedJsonResponse({
        ok: true,
        file: saved,
    })
}

export async function hostedRuntimeStateCallback(
    env: AgentRoomHostedEnv,
    request: Request,
): Promise<Response> {
    let record: Record<string, unknown>
    try {
        const parsed = (await request.json()) as unknown
        record = objectRecord(parsed)
    } catch {
        return hostedJsonResponse(
            {
                ok: false,
                code: 'invalid_request_body',
            },
            {
                status: 400,
            },
        )
    }
    const callback = await requireHostedRuntimeCallback({
        env,
        request,
        record,
    })
    if (callback instanceof Response) {
        return callback
    }
    const state = objectRecord(record.state)
    const relativePath = typeof state.relativePath === 'string' ? state.relativePath : ''
    const operation = parseHostedRuntimeStateOperation(state.operation)
    if (!operation) {
        return hostedJsonResponse(
            {
                ok: false,
                code: 'invalid_state_callback',
                message: 'operation must be upsert or delete',
            },
            {
                status: 400,
            },
        )
    }
    if (!relativePath || (operation === 'upsert' && typeof state.contentBase64 !== 'string')) {
        return hostedJsonResponse(
            {
                ok: false,
                code: 'invalid_state_callback',
                message: 'relativePath and contentBase64 are required for upsert',
            },
            {
                status: 400,
            },
        )
    }
    const saved =
        operation === 'delete'
            ? await deleteHostedRuntimeStateFile({
                  env,
                  workspaceId: callback.workspaceId,
                  roomId: callback.roomId,
                  relativePath,
              })
            : await putHostedRuntimeStateFile({
                  env,
                  workspaceId: callback.workspaceId,
                  roomId: callback.roomId,
                  relativePath,
                  content: new Uint8Array(Buffer.from(String(state.contentBase64), 'base64url')),
              })
    return hostedJsonResponse({
        ok: true,
        state: saved,
    })
}

export async function hostedRuntimeQuotaCallback(
    env: AgentRoomHostedEnv,
    request: Request,
): Promise<Response> {
    let record: Record<string, unknown>
    try {
        const parsed = (await request.json()) as unknown
        record = objectRecord(parsed)
    } catch {
        return hostedJsonResponse(
            {
                ok: false,
                code: 'invalid_request_body',
            },
            {
                status: 400,
            },
        )
    }
    const callback = await requireHostedRuntimeCallback({
        env,
        request,
        record,
    })
    if (callback instanceof Response) {
        return callback
    }
    const action = parseHostedQuotaAction(record.action)
    if (!action) {
        return hostedJsonResponse(
            {
                ok: false,
                code: 'invalid_quota_callback',
                message: 'action is required',
            },
            {
                status: 400,
            },
        )
    }
    try {
        await assertHostedQuotaAllowed({
            env,
            workspaceId: callback.workspaceId,
            roomId: callback.roomId,
            action,
            sessionKey: typeof record.sessionKey === 'string' ? record.sessionKey : null,
            runId: typeof record.runId === 'string' ? record.runId : null,
            jobId: typeof record.jobId === 'string' ? record.jobId : null,
            amount: quotaAmount(record.amount),
        })
    } catch (error) {
        const response = hostedQuotaDeniedResponse(error)
        if (response) {
            return response
        }
        throw error
    }
    return hostedJsonResponse({
        ok: true,
    })
}
