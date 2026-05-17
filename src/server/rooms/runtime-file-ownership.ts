import { chmod, chown, lchown, lstat, mkdir, readdir } from 'node:fs/promises'
import { join } from 'node:path'

function backendIds(): { uid: number; gid: number } | null {
    if (typeof process.getuid !== 'function' || typeof process.getgid !== 'function') {
        return null
    }
    return {
        uid: process.getuid(),
        gid: process.getgid(),
    }
}

async function chownToBackend(path: string): Promise<void> {
    const ids = backendIds()
    if (!ids || typeof process.getuid !== 'function' || process.getuid() !== 0) {
        return
    }
    const stat = await lstat(path)
    if (stat.isSymbolicLink()) {
        await lchown(path, ids.uid, ids.gid)
        return
    }
    await chown(path, ids.uid, ids.gid)
}

export async function ensureBackendOnlyDirectory(path: string): Promise<void> {
    await mkdir(path, {
        recursive: true,
        mode: 0o700,
    })
    await chownToBackend(path)
    await chmod(path, 0o700)
}

export async function ensureBackendOnlyFile(path: string): Promise<void> {
    await chownToBackend(path)
    await chmod(path, 0o600)
}

export async function ensureBackendOnlyTree(path: string): Promise<void> {
    const stat = await lstat(path)
    if (stat.isSymbolicLink()) {
        await chownToBackend(path)
        return
    }
    if (stat.isDirectory()) {
        const entries = await readdir(path, {
            withFileTypes: true,
        })
        await Promise.all(entries.map((entry) => ensureBackendOnlyTree(join(path, entry.name))))
        await chownToBackend(path)
        await chmod(path, 0o700)
        return
    }
    await chownToBackend(path)
    await chmod(path, 0o600)
}
