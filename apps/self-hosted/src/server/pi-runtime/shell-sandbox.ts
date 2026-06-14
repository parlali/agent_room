import type { PiRuntimeConfig } from '../rooms/pi-runtime-config'
import { ensureSandboxOwnedDirectory, ensureSandboxOwnedFile } from '../rooms/sandbox-owned-paths'
import {
    runtimeSandboxShellCommand,
    runtimeSandboxSpawnCommand,
} from '../rooms/runtime-sandbox-command'
import type { RuntimeSandboxIdentity } from '#/domain/domain-types'

export type ShellSandboxIdentity =
    | Extract<RuntimeSandboxIdentity, { mode: 'per-room' }>
    | (RuntimeSandboxIdentity & { mode: 'test-unsafe' })

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
    return runtimeSandboxSpawnCommand(command, args, identity, config.sandboxHardening.limits)
}

export function shellSandboxShellCommand(
    config: PiRuntimeConfig,
    command: string,
): {
    command: string
    args: string[]
} {
    const identity = currentShellSandboxIdentity(config)
    return runtimeSandboxShellCommand(command, identity, config.sandboxHardening.limits)
}

function shellWritableRoots(config: PiRuntimeConfig): string[] {
    return [
        config.paths.workspaceDir,
        config.paths.storeDir,
        config.paths.homeDir,
        config.paths.tmpDir,
    ]
}

export async function ensureShellWritableDirectory(
    config: PiRuntimeConfig,
    path: string,
): Promise<void> {
    const identity = currentShellSandboxIdentity(config)
    await ensureSandboxOwnedDirectory({
        path,
        roots: shellWritableRoots(config),
        identity,
    })
}

export async function ensureShellWritableFile(
    config: PiRuntimeConfig,
    path: string,
): Promise<void> {
    const identity = currentShellSandboxIdentity(config)
    await ensureSandboxOwnedFile({
        path,
        roots: shellWritableRoots(config),
        identity,
    })
}

export const __testing = {
    assertRuntimeSandboxIdentity,
}
