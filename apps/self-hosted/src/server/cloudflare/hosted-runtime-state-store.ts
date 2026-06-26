import { Buffer } from 'node:buffer'
import type { AgentRoomHostedEnv } from './bindings'
import { assertHostedQuotaAllowed } from './hosted-abuse-controls'
import {
    readHostedRuntimeArtifactText,
    readHostedRuntimeArtifactTextOrNull,
    putHostedRuntimeArtifact,
} from './hosted-runtime-artifacts'
import { hostedRoomPaths } from './hosted-runtime-paths'
import {
    hostedRuntimeStateFileKey,
    hostedRuntimeStatePrefix,
    type HostedWorkspaceRoomIdentity,
} from './workspace-storage'
import {
    maxHostedRuntimeStateFileBytes,
    normalizeHostedRuntimeStateRelativePath,
} from '../rooms/hosted-runtime-state-contract'

function runtimeStateAbsolutePath(relativePath: string): string {
    return `${hostedRoomPaths().engineStateDir}/${relativePath}`
}

export async function putHostedRuntimeStateFile(input: {
    env: AgentRoomHostedEnv
    workspaceId: string
    roomId: string
    relativePath: string
    content: Uint8Array
}): Promise<{ relativePath: string; byteLength: number }> {
    if (input.content.byteLength > maxHostedRuntimeStateFileBytes) {
        throw new Error('Hosted runtime state file exceeds the configured byte limit')
    }
    const relativePath = normalizeHostedRuntimeStateRelativePath(input.relativePath)
    await assertHostedQuotaAllowed({
        env: input.env,
        workspaceId: input.workspaceId,
        roomId: input.roomId,
        action: 'runtime_state_sync',
        amount: {
            bytes: input.content.byteLength,
        },
    })
    await putHostedRuntimeArtifact({
        env: input.env,
        key: hostedRuntimeStateFileKey({
            workspaceId: input.workspaceId,
            roomId: input.roomId,
            relativePath,
        }),
        plainText: Buffer.from(input.content).toString('base64url'),
        contentType: 'application/octet-stream',
    })
    return {
        relativePath,
        byteLength: input.content.byteLength,
    }
}

export async function deleteHostedRuntimeStateFile(input: {
    env: AgentRoomHostedEnv
    workspaceId: string
    roomId: string
    relativePath: string
}): Promise<{ relativePath: string }> {
    const relativePath = normalizeHostedRuntimeStateRelativePath(input.relativePath)
    await input.env.AGENT_ROOM_WORKSPACE_BUCKET.delete(
        hostedRuntimeStateFileKey({
            workspaceId: input.workspaceId,
            roomId: input.roomId,
            relativePath,
        }),
    )
    return { relativePath }
}

export async function readHostedRuntimeStateFileTextOrNull(input: {
    env: AgentRoomHostedEnv
    workspaceId: string
    roomId: string
    relativePath: string
}): Promise<string | null> {
    const relativePath = normalizeHostedRuntimeStateRelativePath(input.relativePath)
    const contentBase64 = await readHostedRuntimeArtifactTextOrNull({
        env: input.env,
        key: hostedRuntimeStateFileKey({
            workspaceId: input.workspaceId,
            roomId: input.roomId,
            relativePath,
        }),
    })
    return contentBase64 === null ? null : Buffer.from(contentBase64, 'base64url').toString('utf8')
}

export interface HostedRuntimeStateFileMaterialization {
    path: string
    content: string
    mode: number
}

export async function listHostedRuntimeStateFileMaterializations(
    input: {
        env: AgentRoomHostedEnv
    } & HostedWorkspaceRoomIdentity,
): Promise<HostedRuntimeStateFileMaterialization[]> {
    const prefix = hostedRuntimeStatePrefix(input)
    const files: HostedRuntimeStateFileMaterialization[] = []
    let cursor: string | undefined
    do {
        const listing = await input.env.AGENT_ROOM_WORKSPACE_BUCKET.list({
            prefix,
            cursor,
        })
        for (const object of listing.objects) {
            const relativePath = normalizeHostedRuntimeStateRelativePath(
                decodeURIComponent(object.key.slice(prefix.length)),
            )
            const contentBase64 = await readHostedRuntimeArtifactText({
                env: input.env,
                key: object.key,
            })
            files.push({
                path: runtimeStateAbsolutePath(relativePath),
                content: Buffer.from(contentBase64, 'base64url').toString('utf8'),
                mode: 0o600,
            })
        }
        cursor = listing.truncated ? listing.cursor : undefined
    } while (cursor)
    return files
}
