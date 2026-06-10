import { readFile } from 'node:fs/promises'
import type { RoomPaths, RuntimeSandboxIdentity } from '#/domain/domain-types'

function materializedSandboxIdentity(value: unknown): RuntimeSandboxIdentity | null {
    if (!value || typeof value !== 'object') return null
    const record = value as Record<string, unknown>
    if (
        record.mode === 'per-room' &&
        typeof record.uid === 'number' &&
        typeof record.gid === 'number' &&
        typeof record.userName === 'string' &&
        typeof record.groupName === 'string'
    ) {
        return {
            mode: 'per-room',
            uid: record.uid,
            gid: record.gid,
            userName: record.userName,
            groupName: record.groupName,
        }
    }
    if (record.mode === 'test-unsafe') {
        return {
            mode: 'test-unsafe',
            uid: null,
            gid: null,
            userName: null,
            groupName: null,
        }
    }
    if (record.mode === 'disabled') {
        return {
            mode: 'disabled',
            uid: null,
            gid: null,
            userName: null,
            groupName: null,
        }
    }
    return null
}

export async function readMaterializedRuntimeSandboxIdentity(
    paths: RoomPaths,
): Promise<RuntimeSandboxIdentity | null> {
    try {
        const raw = JSON.parse(await readFile(paths.runtimeMetadataPath, 'utf8')) as {
            sandbox?: unknown
        }
        return materializedSandboxIdentity(raw.sandbox)
    } catch {
        return null
    }
}
