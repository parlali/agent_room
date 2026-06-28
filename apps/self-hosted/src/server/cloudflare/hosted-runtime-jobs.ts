import type { AgentRoomHostedEnv, AgentRoomRuntimeJobMessage } from './bindings'

export async function enqueueHostedRuntimeReconcile(input: {
    env: AgentRoomHostedEnv
    workspaceId: string
    roomId: string
    actorUserId: string | null
}): Promise<void> {
    const message: AgentRoomRuntimeJobMessage = {
        kind: 'room-runtime-reconcile',
        workspaceId: input.workspaceId,
        roomId: input.roomId,
        actorUserId: input.actorUserId,
        requestedAt: new Date().toISOString(),
    }
    await input.env.AGENT_ROOM_RUNTIME_JOBS.send(message)
}

export async function enqueueHostedCronRun(input: {
    env: AgentRoomHostedEnv
    workspaceId: string
    roomId: string
    jobId: string
    lockToken: string
}): Promise<void> {
    const message: AgentRoomRuntimeJobMessage = {
        kind: 'room-cron-run',
        workspaceId: input.workspaceId,
        roomId: input.roomId,
        jobId: input.jobId,
        lockToken: input.lockToken,
        requestedAt: new Date().toISOString(),
    }
    await input.env.AGENT_ROOM_RUNTIME_JOBS.send(message)
}
