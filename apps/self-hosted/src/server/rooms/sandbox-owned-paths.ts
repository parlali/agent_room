import { chmod, chown, lstat, mkdir, realpath, writeFile } from 'node:fs/promises'
import { dirname, join, relative, resolve } from 'node:path'
import type { RuntimeSandboxIdentity } from '#/domain/domain-types'
import { assertPathInsideRoot } from '../security/path-boundary'

function sandboxOwnershipEnabled(
    identity: RuntimeSandboxIdentity,
): identity is Extract<RuntimeSandboxIdentity, { mode: 'per-room' }> {
    return (
        identity.mode === 'per-room' &&
        typeof process.getuid === 'function' &&
        process.getuid() === 0
    )
}

async function applyOwnership(path: string, identity: RuntimeSandboxIdentity): Promise<void> {
    if (sandboxOwnershipEnabled(identity)) {
        await chown(path, identity.uid, identity.gid)
    }
}

function hasErrorCode(error: unknown, code: string): boolean {
    return error instanceof Error && 'code' in error && error.code === code
}

async function lstatIfExists(path: string) {
    try {
        return await lstat(path)
    } catch (error) {
        if (hasErrorCode(error, 'ENOENT')) {
            return null
        }
        throw error
    }
}

async function rootCandidates(root: string): Promise<string[]> {
    const resolved = resolve(root)
    try {
        return [...new Set([resolved, await realpath(root)])]
    } catch {
        return [resolved]
    }
}

async function writableRootFor(path: string, roots: string[]): Promise<string> {
    const candidate = resolve(path)
    const matches = (await Promise.all(roots.map((root) => rootCandidates(root))))
        .flat()
        .filter((root) => {
            try {
                assertPathInsideRoot(candidate, root, 'Path is outside shell-writable roots')
                return true
            } catch {
                return false
            }
        })
        .sort((a, b) => b.length - a.length)
    const root = matches[0]
    if (!root) {
        throw new Error(`Path is outside shell-writable roots: ${path}`)
    }
    return root
}

async function ensureDirectoryNode(path: string, identity: RuntimeSandboxIdentity): Promise<void> {
    let stat = await lstatIfExists(path)
    if (!stat) {
        try {
            await mkdir(path, {
                mode: 0o700,
            })
        } catch (error) {
            if (!hasErrorCode(error, 'EEXIST')) {
                throw error
            }
        }
        stat = await lstat(path)
    }
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
        throw new Error(`Shell-writable path is not a directory: ${path}`)
    }
    await applyOwnership(path, identity)
    await chmod(path, 0o700)
}

export async function ensureSandboxOwnedDirectory(input: {
    path: string
    roots: string[]
    identity: RuntimeSandboxIdentity
}): Promise<void> {
    const root = await writableRootFor(input.path, input.roots)
    const target = assertPathInsideRoot(input.path, root, 'Path is outside shell-writable roots')
    await ensureDirectoryNode(root, input.identity)
    let current = root
    for (const part of relative(root, target)
        .split(/[\\/]+/)
        .filter(Boolean)) {
        current = join(current, part)
        await ensureDirectoryNode(current, input.identity)
    }
}

export async function ensureSandboxOwnedFile(input: {
    path: string
    roots: string[]
    identity: RuntimeSandboxIdentity
}): Promise<void> {
    await ensureSandboxOwnedDirectory({
        path: dirname(input.path),
        roots: input.roots,
        identity: input.identity,
    })
    let stat = await lstatIfExists(input.path)
    if (!stat) {
        try {
            await writeFile(input.path, '', {
                flag: 'wx',
                mode: 0o600,
            })
        } catch (error) {
            if (!hasErrorCode(error, 'EEXIST')) {
                throw error
            }
        }
        stat = await lstat(input.path)
    }
    if (stat.isSymbolicLink() || !stat.isFile()) {
        throw new Error(`Shell-writable path is not a file: ${input.path}`)
    }
    await applyOwnership(input.path, input.identity)
    await chmod(input.path, 0o600)
}
