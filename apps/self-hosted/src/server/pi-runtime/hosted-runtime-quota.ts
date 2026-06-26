import {
    hostedRuntimeQuotaCallbackUrlEnvKey,
    hostedRuntimeRoomIdEnvKey,
    hostedRuntimeUsageCallbackTokenEnvKey,
    hostedRuntimeWorkspaceIdEnvKey,
} from '../rooms/pi-runtime-contract'
import { currentToolRunContext } from './tool-run-context'

export type HostedRuntimeQuotaAction =
    | 'run_start'
    | 'scheduled_job_claim'
    | 'shell_command'
    | 'document_worker'
    | 'image_generation'

export interface HostedRuntimeQuotaAmount {
    count?: number
    bytes?: number
    storageBytes?: number
    cents?: number
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
    if (!url || !token || !workspaceId || !roomId) {
        return
    }
    const context = currentToolRunContext()
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
    })
    if (response.ok) {
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
}
