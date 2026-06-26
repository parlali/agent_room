import {
    hostedRuntimeQuotaCallbackUrlEnvKey,
    hostedRuntimeRoomIdEnvKey,
    hostedRuntimeUsageCallbackTokenEnvKey,
    hostedRuntimeWorkspaceIdEnvKey,
} from '../rooms/pi-runtime-contract'
import type { HostedQuotaAmount, HostedRuntimeQuotaAction } from '../rooms/hosted-quota-contract'
import { combineAbortSignals, currentToolRunContext } from './tool-run-context'

export type { HostedRuntimeQuotaAction }
export type HostedRuntimeQuotaAmount = HostedQuotaAmount

const hostedQuotaCallbackTimeoutMs = 5000

async function assertSuccessResponse(response: Response): Promise<void> {
    let body: unknown
    try {
        body = await response.json()
    } catch {
        throw new Error('Hosted quota callback returned an invalid success response')
    }
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
        throw new Error('Hosted quota callback returned an invalid success response')
    }
    if ((body as { ok?: unknown }).ok !== true) {
        throw new Error('Hosted quota callback returned an invalid success response')
    }
}

export async function assertHostedRuntimeQuota(input: {
    action: HostedRuntimeQuotaAction
    amount?: HostedRuntimeQuotaAmount
    sessionKey?: string | null
    runId?: string | null
    jobId?: string | null
}): Promise<void> {
    const url = process.env[hostedRuntimeQuotaCallbackUrlEnvKey] ?? null
    const token = process.env[hostedRuntimeUsageCallbackTokenEnvKey] ?? null
    const workspaceId = process.env[hostedRuntimeWorkspaceIdEnvKey] ?? null
    const roomId = process.env[hostedRuntimeRoomIdEnvKey] ?? null
    const configured = [url, token, workspaceId, roomId].filter(Boolean).length
    if (configured === 0) {
        return
    }
    if (configured < 4 || !url || !token || !workspaceId || !roomId) {
        throw new Error('Hosted quota runtime configuration is incomplete')
    }
    const context = currentToolRunContext()
    const timeoutController = new AbortController()
    const timeout = setTimeout(() => timeoutController.abort(), hostedQuotaCallbackTimeoutMs)
    timeout.unref?.()
    const combinedSignal = combineAbortSignals([timeoutController.signal, context?.signal])
    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                authorization: `Bearer ${token}`,
                'content-type': 'application/json',
            },
            body: JSON.stringify({
                workspaceId,
                roomId,
                action: input.action,
                amount: input.amount ?? {},
                sessionKey: input.sessionKey ?? context?.sessionKey ?? null,
                runId: input.runId ?? context?.runId ?? null,
                jobId: input.jobId ?? context?.jobId ?? null,
            }),
            signal: combinedSignal.signal,
        })
        if (response.ok) {
            await assertSuccessResponse(response)
            return
        }
        let message = `Hosted quota denied with status ${response.status}`
        try {
            const body = (await response.json()) as { message?: unknown; reason?: unknown }
            const detail =
                typeof body.message === 'string'
                    ? body.message
                    : typeof body.reason === 'string'
                      ? body.reason
                      : null
            if (detail) {
                message = detail
            }
        } catch {}
        throw new Error(message)
    } catch (error) {
        if (timeoutController.signal.aborted) {
            throw new Error('Hosted quota callback timed out')
        }
        if (context?.signal.aborted || (error instanceof Error && error.name === 'AbortError')) {
            throw new Error('Hosted quota callback aborted')
        }
        throw error
    } finally {
        clearTimeout(timeout)
        combinedSignal.dispose()
    }
}
