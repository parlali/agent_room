import type { AgentRoomHostedEnv } from './bindings'

export async function deleteHostedWorkspaceObjects(input: {
    env: AgentRoomHostedEnv
    keys: string[]
}): Promise<void> {
    if (input.keys.length === 0) {
        return
    }
    await input.env.AGENT_ROOM_WORKSPACE_BUCKET.delete(input.keys)
}

export async function deleteHostedWorkspacePrefix(input: {
    env: AgentRoomHostedEnv
    prefix: string
}): Promise<void> {
    let cursor: string | undefined
    do {
        const listing = await input.env.AGENT_ROOM_WORKSPACE_BUCKET.list({
            prefix: input.prefix,
            cursor,
        })
        const keys = listing.objects.map((object) => object.key)
        if (keys.length > 0) {
            await input.env.AGENT_ROOM_WORKSPACE_BUCKET.delete(keys)
        }
        cursor = listing.truncated ? listing.cursor : undefined
    } while (cursor)
}
