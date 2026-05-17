import { chmod, chown, mkdir } from 'node:fs/promises'
import type { PiRuntimeConfig } from '../rooms/pi-runtime-config'
import {
    runtimeSandboxShellCommand,
    runtimeSandboxSpawnCommand,
} from '../rooms/runtime-sandbox-identity'
import type { RuntimeSandboxIdentity } from '../domain/types'

export type ShellSandboxIdentity = Extract<
    RuntimeSandboxIdentity,
    { mode: 'per-room' } | { mode: 'test-unsafe' }
>

function assertRuntimeSandboxIdentity(
    identity: RuntimeSandboxIdentity,
): asserts identity is ShellSandboxIdentity {
    if (identity.mode === 'test-unsafe') {
        if (
            process.env.NODE_ENV === 'test' &&
            process.env.AGENT_ROOM_UNSAFE_ALLOW_UNSANDBOXED_SHELL === '1'
        ) {
            return
        }
        throw new Error('Unsafe unsandboxed runtime identity is only available in tests')
    }

    if (identity.mode === 'per-room' && identity.uid > 0 && identity.gid > 0) {
        return
    }

    throw new Error(
        'Runtime requires a per-room sandbox identity. Start failed closed because no room-local UID/GID was materialized.',
    )
}

export function currentShellSandboxIdentity(config: PiRuntimeConfig): ShellSandboxIdentity {
    assertRuntimeSandboxIdentity(config.sandbox)
    return config.sandbox
}

export function shellSandboxSpawnCommand(
    config: PiRuntimeConfig,
    command: string,
    args: string[],
): {
    command: string
    args: string[]
} {
    const identity = currentShellSandboxIdentity(config)
    return runtimeSandboxSpawnCommand(command, args, identity)
}

export function shellSandboxShellCommand(
    config: PiRuntimeConfig,
    command: string,
): {
    command: string
    args: string[]
} {
    const identity = currentShellSandboxIdentity(config)
    return runtimeSandboxShellCommand(command, identity)
}

async function applyShellOwnership(path: string, identity: ShellSandboxIdentity) {
    if (
        identity.mode === 'per-room' &&
        typeof process.getuid === 'function' &&
        process.getuid() === 0
    ) {
        await chown(path, identity.uid, identity.gid)
    }
}

export async function ensureShellWritableDirectory(
    config: PiRuntimeConfig,
    path: string,
): Promise<void> {
    const identity = currentShellSandboxIdentity(config)
    await mkdir(path, {
        recursive: true,
        mode: 0o700,
    })
    await applyShellOwnership(path, identity)
    await chmod(path, 0o700)
}

export async function ensureShellWritableFile(
    config: PiRuntimeConfig,
    path: string,
): Promise<void> {
    const identity = currentShellSandboxIdentity(config)
    await applyShellOwnership(path, identity)
    await chmod(path, 0o600)
}

export const __testing = {
    assertRuntimeSandboxIdentity,
}
