import { readFile } from 'node:fs/promises'
import { isAbsolute, relative, resolve } from 'node:path'
import type { PiRuntimeConfig } from '../rooms/pi-runtime-config'
import {
    hostedRuntimeStateCallbackUrlEnvKey,
    hostedRuntimeUsageCallbackTokenEnvKey,
    hostedRuntimeWorkspaceIdEnvKey,
} from '../rooms/pi-runtime-contract'
import {
    maxHostedRuntimeStateFileBytes,
    normalizeHostedRuntimeStateRelativePath,
    type HostedRuntimeStateOperation,
} from '../rooms/hosted-runtime-state-contract'
import { postHostedRuntimeCallback } from './hosted-runtime-callback'

function runtimeStateRelativePath(config: PiRuntimeConfig, path: string): string {
    const root = resolve(config.paths.stateDir)
    const resolved = resolve(path)
    const relativePath = relative(root, resolved).replaceAll('\\', '/')
    if (relativePath.startsWith('..') || isAbsolute(relativePath)) {
        throw new Error('Hosted runtime state path escapes the state directory')
    }
    return normalizeHostedRuntimeStateRelativePath(relativePath)
}

async function postHostedRuntimeState(input: {
    url: string
    token: string
    workspaceId: string
    roomId: string
    relativePath: string
    operation: HostedRuntimeStateOperation
    content?: Buffer
}): Promise<void> {
    await postHostedRuntimeCallback({
        url: input.url,
        token: input.token,
        label: 'Hosted runtime state',
        body: {
            workspaceId: input.workspaceId,
            roomId: input.roomId,
            state: {
                operation: input.operation,
                relativePath: input.relativePath,
                ...(input.content
                    ? {
                          contentBase64: input.content.toString('base64url'),
                      }
                    : {}),
            },
        },
    })
}

export function createHostedRuntimeStateSync(config: PiRuntimeConfig): {
    upsert: (path: string) => Promise<void>
    delete: (path: string) => Promise<void>
} {
    const url = process.env[hostedRuntimeStateCallbackUrlEnvKey] ?? null
    const token = process.env[hostedRuntimeUsageCallbackTokenEnvKey] ?? null
    const workspaceId = process.env[hostedRuntimeWorkspaceIdEnvKey] ?? null
    const enabled = Boolean(url && token && workspaceId)
    if (!enabled && (url || token || workspaceId)) {
        throw new Error('Hosted runtime state sync callback configuration is incomplete')
    }

    return {
        async upsert(path: string): Promise<void> {
            if (!enabled) {
                return
            }
            const relativePath = runtimeStateRelativePath(config, path)
            const content = await readFile(path)
            if (content.byteLength > maxHostedRuntimeStateFileBytes) {
                throw new Error('Hosted runtime state file exceeds the configured byte limit')
            }
            await postHostedRuntimeState({
                url: url!,
                token: token!,
                workspaceId: workspaceId!,
                roomId: config.runtime.roomId,
                relativePath,
                operation: 'upsert',
                content,
            })
        },
        async delete(path: string): Promise<void> {
            if (!enabled) {
                return
            }
            await postHostedRuntimeState({
                url: url!,
                token: token!,
                workspaceId: workspaceId!,
                roomId: config.runtime.roomId,
                relativePath: runtimeStateRelativePath(config, path),
                operation: 'delete',
            })
        },
    }
}
