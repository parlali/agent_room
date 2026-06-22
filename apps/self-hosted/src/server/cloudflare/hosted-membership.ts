import type { AgentRoomHostedEnv } from './bindings'
import type { HostedWorkspaceRole } from './hosted-auth'

interface HostedMembershipRow {
    role: string
}

export function normalizeHostedWorkspaceRole(role: string | null): HostedWorkspaceRole | null {
    if (role === 'owner' || role === 'admin' || role === 'member') {
        return role
    }
    return null
}

export async function readHostedWorkspaceRole(input: {
    env: AgentRoomHostedEnv
    userId: string
    workspaceId: string
}): Promise<HostedWorkspaceRole | null> {
    const row = await input.env.AGENT_ROOM_DB.prepare(
        `
            SELECT role
            FROM member
            WHERE userId = ?1
              AND organizationId = ?2
            LIMIT 1
        `,
    )
        .bind(input.userId, input.workspaceId)
        .first<HostedMembershipRow>()

    return normalizeHostedWorkspaceRole(row?.role ?? null)
}
