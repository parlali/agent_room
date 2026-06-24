import type { AgentRoomHostedEnv } from './bindings'

interface HostedMembershipGuardRow {
    matchedOwnerCount: number
    workspaceOwnerCount: number
    workspaceNonOwnerCount: number
    userOwnerWorkspaceCount: number
}

export async function readHostedWorkspaceOwnerMembership(input: {
    env: AgentRoomHostedEnv
    userId: string
    workspaceId: string
}): Promise<boolean> {
    const row = await input.env.AGENT_ROOM_DB.prepare(
        `
            SELECT
                SUM(
                    CASE
                        WHEN userId = ?1
                         AND organizationId = ?2
                         AND role = 'owner'
                        THEN 1
                        ELSE 0
                    END
                ) AS matchedOwnerCount,
                SUM(
                    CASE
                        WHEN organizationId = ?2
                         AND role = 'owner'
                        THEN 1
                        ELSE 0
                    END
                ) AS workspaceOwnerCount,
                SUM(
                    CASE
                        WHEN organizationId = ?2
                         AND role <> 'owner'
                        THEN 1
                        ELSE 0
                    END
                ) AS workspaceNonOwnerCount,
                SUM(
                    CASE
                        WHEN userId = ?1
                         AND role = 'owner'
                        THEN 1
                        ELSE 0
                    END
                ) AS userOwnerWorkspaceCount
            FROM member
            WHERE userId = ?1
               OR organizationId = ?2
        `,
    )
        .bind(input.userId, input.workspaceId)
        .first<HostedMembershipGuardRow>()

    return (
        row?.matchedOwnerCount === 1 &&
        row.workspaceOwnerCount === 1 &&
        row.workspaceNonOwnerCount === 0 &&
        row.userOwnerWorkspaceCount === 1
    )
}
