import type { StopParams } from '@cloudflare/containers'
import type { AgentRoomHostedEnv } from './bindings'
import { markHostedRuntimeContainerStopped } from './hosted-runtime-state-repository'
import type { HostedRuntimeIdentity } from './runtime-contract'

export function parseHostedRuntimeContainerName(
    name: string | undefined,
): HostedRuntimeIdentity | null {
    if (!name) {
        return null
    }
    const match = /^workspace:([A-Za-z0-9_-]{1,128}):room:([A-Za-z0-9_-]{1,128})$/.exec(name)
    if (!match) {
        return null
    }
    return {
        workspaceId: match[1],
        roomId: match[2],
    }
}

export type HostedRuntimeContainerStopOutcome = 'transitioned' | 'noop' | 'unparseable' | 'failed'

export async function handleHostedRuntimeContainerStop(input: {
    env: AgentRoomHostedEnv
    containerName: string | undefined
    stop: StopParams
}): Promise<HostedRuntimeContainerStopOutcome> {
    const identity = parseHostedRuntimeContainerName(input.containerName)
    if (!identity) {
        console.error(
            'Agent Room hosted runtime container stopped but its name is not a canonical room identity; room status left unchanged',
            {
                containerName: input.containerName ?? null,
                exitCode: input.stop.exitCode,
                reason: input.stop.reason,
            },
        )
        return 'unparseable'
    }
    try {
        const transitioned = await markHostedRuntimeContainerStopped({
            env: input.env,
            workspaceId: identity.workspaceId,
            roomId: identity.roomId,
        })
        console.log('Agent Room hosted runtime container stopped', {
            workspaceId: identity.workspaceId,
            roomId: identity.roomId,
            exitCode: input.stop.exitCode,
            reason: input.stop.reason,
            transitioned,
        })
        return transitioned ? 'transitioned' : 'noop'
    } catch (error) {
        console.error(
            'Agent Room hosted runtime container stop transition failed; room stays counted as active until the next runtime transition',
            {
                workspaceId: identity.workspaceId,
                roomId: identity.roomId,
                exitCode: input.stop.exitCode,
                reason: input.stop.reason,
                error: error instanceof Error ? error.message : String(error),
            },
        )
        return 'failed'
    }
}
