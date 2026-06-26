import type { AgentRoomHostedEnv } from './bindings'
import {
    activateHostedBrowserbaseSessionSlot,
    releaseHostedBrowserbaseSessionSlot,
    reserveHostedBrowserbaseSessionSlot,
} from './hosted-billing-repository'
import { readHostedQuotaPolicy } from './hosted-quota-policy'
import type { HostedRuntimeUsageContext } from './hosted-runtime-usage-context'

function pendingBrowserbaseSessionId(input: {
    workspaceId: string
    roomId: string
    usageRequestId: string
}): string {
    return `creating:${input.workspaceId}:${input.roomId}:${input.usageRequestId}`
}

export async function reserveHostedBrowserbaseActiveSessionSlot(input: {
    env: AgentRoomHostedEnv
    workspaceId: string
    roomId: string
    usageRequestId: string
    usageContext: HostedRuntimeUsageContext
}): Promise<string | null> {
    const policy = await readHostedQuotaPolicy({
        env: input.env,
        workspaceId: input.workspaceId,
    })
    const pendingBrowserbaseSessionIdValue = pendingBrowserbaseSessionId(input)
    const reserved = await reserveHostedBrowserbaseSessionSlot({
        env: input.env,
        workspaceId: input.workspaceId,
        roomId: input.roomId,
        pendingBrowserbaseSessionId: pendingBrowserbaseSessionIdValue,
        usageRequestId: input.usageRequestId,
        usageContext: input.usageContext,
        maxWorkspaceActiveSessions: policy.limits.maxWorkspaceBrowserbaseActiveSessions,
        maxRoomActiveSessions: policy.limits.maxRoomBrowserbaseActiveSessions,
    })
    return reserved ? pendingBrowserbaseSessionIdValue : null
}

export async function activateHostedBrowserbaseActiveSessionSlot(input: {
    env: AgentRoomHostedEnv
    workspaceId: string
    roomId: string
    pendingBrowserbaseSessionId: string | null
    browserbaseSessionId: string
    usageRequestId: string
}): Promise<boolean> {
    if (!input.pendingBrowserbaseSessionId) {
        return false
    }
    return activateHostedBrowserbaseSessionSlot({
        env: input.env,
        workspaceId: input.workspaceId,
        roomId: input.roomId,
        pendingBrowserbaseSessionId: input.pendingBrowserbaseSessionId,
        browserbaseSessionId: input.browserbaseSessionId,
        usageRequestId: input.usageRequestId,
    })
}

export async function releaseHostedBrowserbaseActiveSessionSlot(input: {
    env: AgentRoomHostedEnv
    workspaceId: string
    roomId: string
    pendingBrowserbaseSessionId: string | null
}): Promise<void> {
    if (!input.pendingBrowserbaseSessionId) {
        return
    }
    await releaseHostedBrowserbaseSessionSlot({
        env: input.env,
        workspaceId: input.workspaceId,
        roomId: input.roomId,
        pendingBrowserbaseSessionId: input.pendingBrowserbaseSessionId,
    })
}
