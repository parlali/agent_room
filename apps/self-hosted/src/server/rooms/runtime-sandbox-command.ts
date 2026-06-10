import type { RuntimeSandboxIdentity } from '#/domain/domain-types'

function shouldWrapSandboxCommand(identity: RuntimeSandboxIdentity): boolean {
    if (identity.mode !== 'per-room') return false
    const currentUid = typeof process.getuid === 'function' ? process.getuid() : null
    const currentGid = typeof process.getgid === 'function' ? process.getgid() : null
    return currentUid !== identity.uid || currentGid !== identity.gid
}

export function runtimeSandboxSpawnCommand(
    command: string,
    args: string[],
    identity: RuntimeSandboxIdentity,
): {
    command: string
    args: string[]
} {
    if (!shouldWrapSandboxCommand(identity)) {
        return {
            command,
            args,
        }
    }
    if (identity.mode !== 'per-room') {
        return {
            command,
            args,
        }
    }
    return {
        command: 'setpriv',
        args: [
            '--reuid',
            String(identity.uid),
            '--regid',
            String(identity.gid),
            '--clear-groups',
            '--no-new-privs',
            command,
            ...args,
        ],
    }
}

export function runtimeSandboxShellCommand(
    command: string,
    identity: RuntimeSandboxIdentity,
): {
    command: string
    args: string[]
} {
    return runtimeSandboxSpawnCommand('/bin/sh', ['-c', command], identity)
}
