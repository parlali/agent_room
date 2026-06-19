import type { AgentRoomRuntimeContainer } from './runtime-container'

export interface AgentRoomRuntimeJobMessage {
    kind: 'room-runtime-reconcile'
    workspaceId: string
    roomId: string
    actorUserId: string | null
    requestedAt: string
}

export interface AgentRoomHostedEnv {
    AGENT_ROOM_DB: D1Database
    AGENT_ROOM_WORKSPACE_BUCKET: R2Bucket
    AGENT_ROOM_RUNTIME_JOBS: Queue<AgentRoomRuntimeJobMessage>
    AGENT_ROOM_RUNTIME: DurableObjectNamespace<AgentRoomRuntimeContainer>
    AGENT_ROOM_AUTH_MODE: string
    AGENT_ROOM_RUNTIME_BACKEND: string
    AGENT_ROOM_RUNTIME_STORAGE: string
    BETTER_AUTH_SECRET: string
    BETTER_AUTH_URL: string
    GOOGLE_CLIENT_ID: string
    GOOGLE_CLIENT_SECRET: string
    AGENT_ROOM_EMAIL_WEBHOOK_URL: string
    AGENT_ROOM_EMAIL_WEBHOOK_BEARER_TOKEN: string
    AGENT_ROOM_EMAIL_FROM: string
}

export type HostedExecutionContext = ExecutionContext
