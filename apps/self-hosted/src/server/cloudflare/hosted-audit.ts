import type { JsonValue } from '#/domain/domain-types'
import type { AgentRoomHostedEnv } from './bindings'
import { nowIso, stringifyJson } from './hosted-json'

export async function appendHostedAudit(input: {
    env: AgentRoomHostedEnv
    workspaceId: string
    actorUserId: string | null
    roomId: string | null
    action: string
    payload: JsonValue
    now?: Date
}): Promise<void> {
    await input.env.AGENT_ROOM_DB.prepare(
        `
            INSERT INTO hosted_audit_event (
                workspace_id,
                actor_user_id,
                room_id,
                action,
                payload,
                created_at
            )
            VALUES (?1, ?2, ?3, ?4, ?5, ?6)
        `,
    )
        .bind(
            input.workspaceId,
            input.actorUserId,
            input.roomId,
            input.action,
            stringifyJson(input.payload),
            nowIso(input.now),
        )
        .run()
}
