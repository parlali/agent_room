import { constants } from 'node:fs'
import { lstat, mkdir, open, unlink } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'

function assertPathInsideRoot(input: { root: string; path: string }): {
    root: string
    path: string
} {
    const root = resolve(input.root)
    const path = resolve(input.path)
    const relativePath = relative(root, path)
    if (relativePath.startsWith('..') || isAbsolute(relativePath)) {
        throw new Error('Visible file path escapes the room boundary')
    }
    return { root, path }
}

async function assertNoSymlinkAncestors(input: { root: string; path: string }): Promise<void> {
    const checked = assertPathInsideRoot(input)
    const directory = dirname(checked.path)
    const relativeDirectory = relative(checked.root, directory)
    const parts = relativeDirectory ? relativeDirectory.split(/[\\/]+/).filter(Boolean) : []
    let current = checked.root
    const roots = [current, ...parts.map((part) => (current = join(current, part)))]
    for (const path of roots) {
        const info = await lstat(path)
        if (info.isSymbolicLink()) {
            throw new Error('Visible file path traverses a symbolic link')
        }
    }
}

async function ensureRealParentDirectory(input: { root: string; path: string }): Promise<void> {
    const checked = assertPathInsideRoot(input)
    const directory = dirname(checked.path)
    const relativeDirectory = relative(checked.root, directory)
    const parts = relativeDirectory ? relativeDirectory.split(/[\\/]+/).filter(Boolean) : []
    let current = checked.root
    for (const path of [checked.root, ...parts.map((part) => (current = join(current, part)))]) {
        let info
        try {
            info = await lstat(path)
        } catch (error) {
            if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') {
                throw error
            }
            await mkdir(path, {
                mode: 0o700,
            })
            info = await lstat(path)
        }
        if (info.isSymbolicLink()) {
            throw new Error('Visible file path traverses a symbolic link')
        }
        if (!info.isDirectory()) {
            throw new Error('Visible file parent path is not a directory')
        }
    }
}

export async function writeVisibleFileNoFollow(input: {
    root: string
    path: string
    content: Uint8Array
    mode: number
}): Promise<void> {
    const checked = assertPathInsideRoot(input)
    await ensureRealParentDirectory(checked)
    const handle = await open(
        checked.path,
        constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | constants.O_NOFOLLOW,
        input.mode,
    )
    try {
        await handle.writeFile(input.content)
        await handle.chmod(input.mode)
    } finally {
        await handle.close()
    }
}

export async function readVisibleFileNoFollow(input: {
    root: string
    path: string
    maxBytes?: number
}): Promise<{
    content: Buffer
    byteLength: number
}> {
    const checked = assertPathInsideRoot(input)
    await assertNoSymlinkAncestors(checked)
    const handle = await open(checked.path, constants.O_RDONLY | constants.O_NOFOLLOW)
    try {
        const info = await handle.stat()
        if (!info.isFile()) {
            throw new Error('Visible path is not a file')
        }
        if (input.maxBytes !== undefined && info.size > input.maxBytes) {
            throw new Error('Visible file exceeds the configured byte limit')
        }
        const content = await handle.readFile()
        return {
            content,
            byteLength: content.byteLength,
        }
    } finally {
        await handle.close()
    }
}

export async function deleteVisibleFileNoFollow(input: {
    root: string
    path: string
}): Promise<void> {
    const checked = assertPathInsideRoot(input)
    await assertNoSymlinkAncestors(checked)
    const handle = await open(checked.path, constants.O_RDONLY | constants.O_NOFOLLOW)
    try {
        const info = await handle.stat()
        if (!info.isFile()) {
            throw new Error('Visible path is not a file')
        }
    } finally {
        await handle.close()
    }
    await unlink(checked.path)
}
