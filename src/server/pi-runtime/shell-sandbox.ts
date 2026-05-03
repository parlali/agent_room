import { chmod, chown, mkdir } from 'node:fs/promises'

const sandboxShellUid = 65534
const sandboxShellGid = 65534

export interface ShellSandboxIdentity {
    uid?: number
    gid?: number
    mode: 'dropped' | 'test-unsafe'
}

export function resolveShellSandboxIdentity(input: {
    nodeEnv?: string
    unsafeAllowUnsandboxed?: string
    uid?: number | null
}): ShellSandboxIdentity {
    if (input.uid === 0) {
        return {
            uid: sandboxShellUid,
            gid: sandboxShellGid,
            mode: 'dropped',
        }
    }

    if (input.nodeEnv === 'test' && input.unsafeAllowUnsandboxed === '1') {
        return {
            mode: 'test-unsafe',
        }
    }

    throw new Error(
        'Shell tool requires a sandboxed runtime user. Run Agent Room in the Docker image or disable shell tools for this room.',
    )
}

export function currentShellSandboxIdentity(): ShellSandboxIdentity {
    return resolveShellSandboxIdentity({
        nodeEnv: process.env.NODE_ENV,
        unsafeAllowUnsandboxed: process.env.AGENT_ROOM_UNSAFE_ALLOW_UNSANDBOXED_SHELL,
        uid: typeof process.getuid === 'function' ? process.getuid() : null,
    })
}

async function applyDroppedShellOwnership(path: string, identity: ShellSandboxIdentity) {
    if (identity.uid !== undefined && identity.gid !== undefined) {
        await chown(path, identity.uid, identity.gid)
    }
}

export async function ensureShellWritableDirectory(path: string): Promise<void> {
    const identity = currentShellSandboxIdentity()
    await mkdir(path, {
        recursive: true,
        mode: 0o700,
    })
    await applyDroppedShellOwnership(path, identity)
    await chmod(path, 0o700)
}

export async function ensureShellWritableFile(path: string): Promise<void> {
    const identity = currentShellSandboxIdentity()
    await applyDroppedShellOwnership(path, identity)
    await chmod(path, 0o600)
}
