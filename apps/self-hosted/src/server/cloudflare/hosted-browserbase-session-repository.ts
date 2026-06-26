import type { AgentRoomHostedEnv } from './bindings'
import { nowIso } from './hosted-json'
import type { HostedRuntimeUsageContext } from './hosted-runtime-usage-context'

export type HostedBrowserbaseSessionStatus =
    | 'creating'
    | 'active'
    | 'release_requested'
    | 'released'

interface HostedBrowserbaseSessionRow {
    browserbaseSessionId: string
    workspaceId: string
    roomId: string
    sessionKey: string | null
    runId: string | null
    jobId: string | null
    usageRequestId: string
    status: HostedBrowserbaseSessionStatus
    createdAt: string
    updatedAt: string
    releasedAt: string | null
}

export interface HostedBrowserbaseSession {
    browserbaseSessionId: string
    workspaceId: string
    roomId: string
    sessionKey: string | null
    runId: string | null
    jobId: string | null
    usageRequestId: string
    status: HostedBrowserbaseSessionStatus
    createdAt: string
    updatedAt: string
    releasedAt: string | null
}

const browserbaseSessionProjection = `
    browserbase_session_id AS browserbaseSessionId,
    workspace_id AS workspaceId,
    room_id AS roomId,
    session_key AS sessionKey,
    run_id AS runId,
    job_id AS jobId,
    usage_request_id AS usageRequestId,
    status,
    created_at AS createdAt,
    updated_at AS updatedAt,
    released_at AS releasedAt
`

function mapBrowserbaseSession(row: HostedBrowserbaseSessionRow): HostedBrowserbaseSession {
    return {
        browserbaseSessionId: row.browserbaseSessionId,
        workspaceId: row.workspaceId,
        roomId: row.roomId,
        sessionKey: row.sessionKey,
        runId: row.runId,
        jobId: row.jobId,
        usageRequestId: row.usageRequestId,
        status: row.status,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
        releasedAt: row.releasedAt,
    }
}

export async function recordHostedBrowserbaseSession(input: {
    env: AgentRoomHostedEnv
    workspaceId: string
    roomId: string
    browserbaseSessionId: string
    usageRequestId: string
    usageContext: HostedRuntimeUsageContext
    now?: Date
}): Promise<void> {
    const now = nowIso(input.now)
    await input.env.AGENT_ROOM_DB.prepare(
        `
            INSERT INTO hosted_browserbase_session (
                browserbase_session_id,
                workspace_id,
                room_id,
                session_key,
                run_id,
                job_id,
                usage_request_id,
                status,
                created_at,
                updated_at,
                released_at
            )
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 'active', ?8, ?8, NULL)
        `,
    )
        .bind(
            input.browserbaseSessionId,
            input.workspaceId,
            input.roomId,
            input.usageContext.sessionKey,
            input.usageContext.runId,
            input.usageContext.jobId,
            input.usageRequestId,
            now,
        )
        .run()
}

export async function reserveHostedBrowserbaseSessionSlot(input: {
    env: AgentRoomHostedEnv
    workspaceId: string
    roomId: string
    pendingBrowserbaseSessionId: string
    usageRequestId: string
    usageContext: HostedRuntimeUsageContext
    maxWorkspaceActiveSessions: number
    maxRoomActiveSessions: number
    now?: Date
}): Promise<boolean> {
    const now = nowIso(input.now)
    const result = await input.env.AGENT_ROOM_DB.prepare(
        `
            INSERT INTO hosted_browserbase_session (
                browserbase_session_id,
                workspace_id,
                room_id,
                session_key,
                run_id,
                job_id,
                usage_request_id,
                status,
                created_at,
                updated_at,
                released_at
            )
            SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, 'creating', ?8, ?8, NULL
            WHERE (
                SELECT COUNT(*)
                FROM hosted_browserbase_session
                WHERE workspace_id = ?2
                  AND status IN ('creating', 'active', 'release_requested')
            ) < ?9
              AND (
                SELECT COUNT(*)
                FROM hosted_browserbase_session
                WHERE workspace_id = ?2
                  AND room_id = ?3
                  AND status IN ('creating', 'active', 'release_requested')
            ) < ?10
            ON CONFLICT(workspace_id, room_id, usage_request_id) DO NOTHING
        `,
    )
        .bind(
            input.pendingBrowserbaseSessionId,
            input.workspaceId,
            input.roomId,
            input.usageContext.sessionKey,
            input.usageContext.runId,
            input.usageContext.jobId,
            input.usageRequestId,
            now,
            input.maxWorkspaceActiveSessions,
            input.maxRoomActiveSessions,
        )
        .run()
    return (result.meta.changes ?? 0) > 0
}

export async function activateHostedBrowserbaseSessionSlot(input: {
    env: AgentRoomHostedEnv
    workspaceId: string
    roomId: string
    pendingBrowserbaseSessionId: string
    browserbaseSessionId: string
    usageRequestId: string
    now?: Date
}): Promise<boolean> {
    const now = nowIso(input.now)
    const result = await input.env.AGENT_ROOM_DB.prepare(
        `
            UPDATE hosted_browserbase_session
            SET browserbase_session_id = ?4,
                status = 'active',
                updated_at = ?6
            WHERE workspace_id = ?1
              AND room_id = ?2
              AND usage_request_id = ?3
              AND browserbase_session_id = ?5
              AND status = 'creating'
        `,
    )
        .bind(
            input.workspaceId,
            input.roomId,
            input.usageRequestId,
            input.browserbaseSessionId,
            input.pendingBrowserbaseSessionId,
            now,
        )
        .run()
    return (result.meta.changes ?? 0) > 0
}

export async function releaseHostedBrowserbaseSessionSlot(input: {
    env: AgentRoomHostedEnv
    workspaceId: string
    roomId: string
    pendingBrowserbaseSessionId: string
    now?: Date
}): Promise<void> {
    const now = nowIso(input.now)
    await input.env.AGENT_ROOM_DB.prepare(
        `
            UPDATE hosted_browserbase_session
            SET status = 'released',
                updated_at = ?4,
                released_at = ?4
            WHERE workspace_id = ?1
              AND room_id = ?2
              AND browserbase_session_id = ?3
              AND status = 'creating'
        `,
    )
        .bind(input.workspaceId, input.roomId, input.pendingBrowserbaseSessionId, now)
        .run()
}

export async function readHostedBrowserbaseSession(input: {
    env: AgentRoomHostedEnv
    workspaceId: string
    roomId: string
    browserbaseSessionId: string
}): Promise<HostedBrowserbaseSession | null> {
    const row = await input.env.AGENT_ROOM_DB.prepare(
        `
            SELECT
                ${browserbaseSessionProjection}
            FROM hosted_browserbase_session
            WHERE workspace_id = ?1
              AND room_id = ?2
              AND browserbase_session_id = ?3
            LIMIT 1
        `,
    )
        .bind(input.workspaceId, input.roomId, input.browserbaseSessionId)
        .first<HostedBrowserbaseSessionRow>()
    return row ? mapBrowserbaseSession(row) : null
}

export async function readHostedBrowserbaseSessionByUsageRequestId(input: {
    env: AgentRoomHostedEnv
    workspaceId: string
    roomId: string
    usageRequestId: string
}): Promise<HostedBrowserbaseSession | null> {
    const row = await input.env.AGENT_ROOM_DB.prepare(
        `
            SELECT
                ${browserbaseSessionProjection}
            FROM hosted_browserbase_session
            WHERE workspace_id = ?1
              AND room_id = ?2
              AND usage_request_id = ?3
            LIMIT 1
        `,
    )
        .bind(input.workspaceId, input.roomId, input.usageRequestId)
        .first<HostedBrowserbaseSessionRow>()
    return row ? mapBrowserbaseSession(row) : null
}

export async function requestHostedBrowserbaseSessionRelease(input: {
    env: AgentRoomHostedEnv
    workspaceId: string
    roomId: string
    browserbaseSessionId: string
    now?: Date
}): Promise<boolean> {
    const now = nowIso(input.now)
    const result = await input.env.AGENT_ROOM_DB.prepare(
        `
            UPDATE hosted_browserbase_session
            SET status = 'release_requested',
                updated_at = ?4
            WHERE workspace_id = ?1
              AND room_id = ?2
              AND browserbase_session_id = ?3
              AND status IN ('active', 'release_requested')
        `,
    )
        .bind(input.workspaceId, input.roomId, input.browserbaseSessionId, now)
        .run()
    return (result.meta.changes ?? 0) > 0
}

export async function markHostedBrowserbaseSessionReleased(input: {
    env: AgentRoomHostedEnv
    workspaceId: string
    roomId: string
    browserbaseSessionId: string
    now?: Date
}): Promise<void> {
    const now = nowIso(input.now)
    await input.env.AGENT_ROOM_DB.prepare(
        `
            UPDATE hosted_browserbase_session
            SET status = 'released',
                updated_at = ?4,
                released_at = ?4
            WHERE workspace_id = ?1
              AND room_id = ?2
              AND browserbase_session_id = ?3
        `,
    )
        .bind(input.workspaceId, input.roomId, input.browserbaseSessionId, now)
        .run()
}
