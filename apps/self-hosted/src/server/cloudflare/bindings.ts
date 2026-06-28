import type { D1Database, ExecutionContext, Queue, R2Bucket } from '@cloudflare/workers-types'
import type { HostedRuntimeContainerNamespace } from './runtime-contract'

export interface AgentRoomRuntimeReconcileMessage {
    kind: 'room-runtime-reconcile'
    workspaceId: string
    roomId: string
    actorUserId: string | null
    requestedAt: string
}

export interface AgentRoomCronRunMessage {
    kind: 'room-cron-run'
    workspaceId: string
    roomId: string
    jobId: string
    lockToken: string
    requestedAt: string
}

export type AgentRoomRuntimeJobMessage = AgentRoomRuntimeReconcileMessage | AgentRoomCronRunMessage

export interface AgentRoomHostedEnv {
    AGENT_ROOM_DB: D1Database
    AGENT_ROOM_WORKSPACE_BUCKET: R2Bucket
    AGENT_ROOM_RUNTIME_JOBS: Queue<AgentRoomRuntimeJobMessage>
    AGENT_ROOM_RUNTIME: HostedRuntimeContainerNamespace
    ASSETS?: {
        fetch: typeof fetch
    }
    AGENT_ROOM_AUTH_MODE: string
    AGENT_ROOM_BILLING_USAGE_MARKUP_BPS: string
    AGENT_ROOM_BILLING_TAX_MODE: string
    AGENT_ROOM_BILLING_MAX_CONCURRENT_ROOMS: string
    AGENT_ROOM_HOSTED_DISABLE_RUNTIME_EXECUTION?: string
    AGENT_ROOM_HOSTED_DISABLE_HOSTED_MODELS?: string
    AGENT_ROOM_HOSTED_DISABLE_MANAGED_WEB?: string
    AGENT_ROOM_HOSTED_DISABLE_BROWSERBASE?: string
    AGENT_ROOM_HOSTED_DISABLE_SCHEDULED_JOBS?: string
    AGENT_ROOM_HOSTED_DISABLE_SHELL?: string
    AGENT_ROOM_HOSTED_DISABLE_STORAGE?: string
    AGENT_ROOM_HOSTED_DISABLE_IMAGE_GENERATION?: string
    AGENT_ROOM_HOSTED_DISABLE_DOCUMENT_WORKERS?: string
    AGENT_ROOM_RUNTIME_BACKEND: string
    AGENT_ROOM_RUNTIME_STORAGE: string
    BETTER_AUTH_SECRET: string
    BETTER_AUTH_URL: string
    AGENT_ROOM_HOSTED_ENCRYPTION_KEY_B64?: string
    GOOGLE_CLIENT_ID?: string
    GOOGLE_CLIENT_SECRET?: string
    STRIPE_SECRET_KEY?: string
    STRIPE_WEBHOOK_SECRET?: string
    AGENT_ROOM_HOSTED_OPENROUTER_API_KEY?: string
    AGENT_ROOM_HOSTED_BRAVE_API_KEY?: string
    AGENT_ROOM_HOSTED_BROWSERBASE_API_KEY?: string
    AGENT_ROOM_EMAIL_WEBHOOK_URL: string
    AGENT_ROOM_EMAIL_WEBHOOK_BEARER_TOKEN: string
    AGENT_ROOM_EMAIL_FROM: string
}

export type HostedExecutionContext = ExecutionContext
