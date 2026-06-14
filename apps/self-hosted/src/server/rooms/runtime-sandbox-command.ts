import type { RuntimeSandboxIdentity, RuntimeSandboxResourceLimits } from '#/domain/domain-types'

interface SandboxCommand {
    command: string
    args: string[]
}

const unlimitedResourceLimits: RuntimeSandboxResourceLimits = {
    cpuSeconds: null,
    addressSpaceBytes: null,
    fileSizeBytes: null,
    processCount: null,
    openFiles: null,
}

function shouldWrapSandboxCommand(identity: RuntimeSandboxIdentity): boolean {
    if (identity.mode !== 'per-room') return false
    const currentUid = typeof process.getuid === 'function' ? process.getuid() : null
    const currentGid = typeof process.getgid === 'function' ? process.getgid() : null
    return currentUid !== identity.uid || currentGid !== identity.gid
}

export function buildResourceLimitArgs(limits: RuntimeSandboxResourceLimits): string[] {
    const args = ['--core=0']
    if (limits.cpuSeconds !== null) args.push(`--cpu=${limits.cpuSeconds}`)
    if (limits.fileSizeBytes !== null) args.push(`--fsize=${limits.fileSizeBytes}`)
    if (limits.addressSpaceBytes !== null) args.push(`--as=${limits.addressSpaceBytes}`)
    if (limits.processCount !== null) args.push(`--nproc=${limits.processCount}`)
    if (limits.openFiles !== null) args.push(`--nofile=${limits.openFiles}`)
    return args
}

export function runtimeSandboxSpawnCommand(
    command: string,
    args: string[],
    identity: RuntimeSandboxIdentity,
    limits?: RuntimeSandboxResourceLimits,
): SandboxCommand {
    if (!shouldWrapSandboxCommand(identity) || identity.mode !== 'per-room') {
        return {
            command,
            args,
        }
    }
    const dropped: SandboxCommand = {
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
    return {
        command: 'prlimit',
        args: [
            ...buildResourceLimitArgs(limits ?? unlimitedResourceLimits),
            '--',
            dropped.command,
            ...dropped.args,
        ],
    }
}

export function runtimeSandboxShellCommand(
    command: string,
    identity: RuntimeSandboxIdentity,
    limits?: RuntimeSandboxResourceLimits,
): SandboxCommand {
    return runtimeSandboxSpawnCommand('/bin/sh', ['-c', command], identity, limits)
}
