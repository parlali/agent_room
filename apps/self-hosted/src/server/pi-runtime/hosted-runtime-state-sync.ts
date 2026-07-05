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

const hostedRuntimeStateSyncMaxConcurrency = 4

let activeStateSyncCount = 0
const stateSyncSlotWaiters: Array<() => void> = []

function acquireStateSyncSlot(): Promise<void> {
    if (activeStateSyncCount < hostedRuntimeStateSyncMaxConcurrency) {
        activeStateSyncCount += 1
        return Promise.resolve()
    }
    return new Promise<void>((release) => {
        stateSyncSlotWaiters.push(release)
    })
}

function releaseStateSyncSlot(): void {
    const next = stateSyncSlotWaiters.shift()
    if (next) {
        next()
        return
    }
    activeStateSyncCount -= 1
}

interface StateSyncWaiter {
    resolve: () => void
    reject: (error: unknown) => void
}

interface PendingStateSyncOperation {
    kind: HostedRuntimeStateOperation
    run: () => Promise<void>
    waiters: StateSyncWaiter[]
}

interface PathSyncState {
    draining: boolean
    queue: PendingStateSyncOperation[]
}

const pathSyncStates = new Map<string, PathSyncState>()

async function drainPathSyncQueue(path: string, state: PathSyncState): Promise<void> {
    while (state.queue.length > 0) {
        const operation = state.queue.shift()!
        await acquireStateSyncSlot()
        try {
            await operation.run()
            for (const waiter of operation.waiters) {
                waiter.resolve()
            }
        } catch (error) {
            for (const waiter of operation.waiters) {
                waiter.reject(error)
            }
        } finally {
            releaseStateSyncSlot()
        }
    }
    state.draining = false
    pathSyncStates.delete(path)
}

function enqueueStateSyncOperation(
    path: string,
    kind: HostedRuntimeStateOperation,
    run: () => Promise<void>,
): Promise<void> {
    let state = pathSyncStates.get(path)
    if (!state) {
        state = { draining: false, queue: [] }
        pathSyncStates.set(path, state)
    }
    const tail = state.queue[state.queue.length - 1]
    if (tail && tail.kind === 'upsert' && kind === 'upsert') {
        return new Promise<void>((resolveWaiter, rejectWaiter) => {
            tail.waiters.push({ resolve: resolveWaiter, reject: rejectWaiter })
        })
    }
    const operation: PendingStateSyncOperation = { kind, run, waiters: [] }
    const result = new Promise<void>((resolveWaiter, rejectWaiter) => {
        operation.waiters.push({ resolve: resolveWaiter, reject: rejectWaiter })
    })
    state.queue.push(operation)
    if (!state.draining) {
        state.draining = true
        void drainPathSyncQueue(path, state)
    }
    return result
}

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
            const absolutePath = resolve(path)
            await enqueueStateSyncOperation(absolutePath, 'upsert', async () => {
                const relativePath = runtimeStateRelativePath(config, absolutePath)
                const content = await readFile(absolutePath)
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
            })
        },
        async delete(path: string): Promise<void> {
            if (!enabled) {
                return
            }
            const absolutePath = resolve(path)
            await enqueueStateSyncOperation(absolutePath, 'delete', async () => {
                await postHostedRuntimeState({
                    url: url!,
                    token: token!,
                    workspaceId: workspaceId!,
                    roomId: config.runtime.roomId,
                    relativePath: runtimeStateRelativePath(config, absolutePath),
                    operation: 'delete',
                })
            })
        },
    }
}
