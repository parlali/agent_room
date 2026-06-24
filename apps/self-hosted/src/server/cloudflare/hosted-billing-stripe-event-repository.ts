import type { AgentRoomHostedEnv } from './bindings'
import { nowIso } from './hosted-json'

export async function recordHostedStripeEvent(input: {
    env: AgentRoomHostedEnv
    eventId: string
    type: string
    livemode: boolean
    now?: Date
}): Promise<boolean> {
    const result = await input.env.AGENT_ROOM_DB.prepare(
        `
            INSERT OR IGNORE INTO hosted_stripe_event (id, type, livemode, processed_at)
            VALUES (?1, ?2, ?3, ?4)
        `,
    )
        .bind(input.eventId, input.type, input.livemode ? 1 : 0, nowIso(input.now))
        .run()
    return (result.meta.changes ?? 0) > 0
}

export async function hostedStripeEventExists(input: {
    env: AgentRoomHostedEnv
    eventId: string
}): Promise<boolean> {
    const row = await input.env.AGENT_ROOM_DB.prepare(
        `
            SELECT 1 AS present
            FROM hosted_stripe_event
            WHERE id = ?1
            LIMIT 1
        `,
    )
        .bind(input.eventId)
        .first<{ present: number }>()
    return row !== null
}
