import { chmod, chown, lchown, lstat, mkdir, readdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { RoomPaths, RuntimeSandboxIdentity } from '#/domain/domain-types'
import { ensureSandboxOwnedDirectory, ensureSandboxOwnedFile } from './sandbox-owned-paths'
import { readMaterializedRuntimeSandboxIdentity } from './runtime-sandbox-materialized'

async function chownPath(path: string, uid: number, gid: number): Promise<void> {
    const stat = await lstat(path)
    if (stat.isSymbolicLink()) {
        await lchown(path, uid, gid)
        return
    }
    await chown(path, uid, gid)
}

async function chownTree(path: string, uid: number, gid: number): Promise<void> {
    const stat = await lstat(path)
    if (stat.isDirectory() && !stat.isSymbolicLink()) {
        const entries = await readdir(path, {
            withFileTypes: true,
        })
        for (const entry of entries) {
            await chownTree(join(path, entry.name), uid, gid)
        }
        await chmod(path, 0o700)
    }
    await chownPath(path, uid, gid)
}

function runtimeShellWritableRoots(paths: RoomPaths): string[] {
    return [
        paths.workspaceDir,
        paths.storeDir,
        join(paths.engineStateDir, 'home'),
        join(paths.engineStateDir, 'tmp'),
    ]
}

function roomContainerDir(paths: RoomPaths): string {
    return dirname(paths.roomRootDir)
}

function materializedOrDisabledIdentity(
    identity: RuntimeSandboxIdentity | null,
): RuntimeSandboxIdentity {
    return (
        identity ?? {
            mode: 'disabled',
            uid: null,
            gid: null,
            userName: null,
            groupName: null,
        }
    )
}

async function ensureRoomRootForMaterializedPath(
    paths: RoomPaths,
    identity: RuntimeSandboxIdentity,
): Promise<void> {
    const mode = identity.mode === 'per-room' ? 0o711 : 0o700
    await mkdir(roomContainerDir(paths), { recursive: true, mode })
    await chmod(roomContainerDir(paths), mode)
    await mkdir(paths.roomRootDir, { recursive: true, mode })
    await chmod(paths.roomRootDir, mode)
}

export async function applyRuntimeSandboxFilesystemOwnership(
    paths: RoomPaths,
    identity: RuntimeSandboxIdentity,
): Promise<void> {
    if (identity.mode !== 'per-room') return
    const homeDir = join(paths.engineStateDir, 'home')
    const tmpDir = join(paths.engineStateDir, 'tmp')
    await Promise.all([
        mkdir(roomContainerDir(paths), { recursive: true, mode: 0o711 }),
        mkdir(paths.roomRootDir, { recursive: true, mode: 0o711 }),
        mkdir(paths.runtimeDir, { recursive: true, mode: 0o700 }),
        mkdir(paths.runtimeSecretsDir, { recursive: true, mode: 0o700 }),
        mkdir(paths.engineStateDir, { recursive: true, mode: 0o711 }),
        mkdir(paths.workspaceDir, { recursive: true, mode: 0o700 }),
        mkdir(paths.storeDir, { recursive: true, mode: 0o700 }),
        mkdir(homeDir, { recursive: true, mode: 0o700 }),
        mkdir(tmpDir, { recursive: true, mode: 0o700 }),
    ])
    await Promise.all([
        chmod(roomContainerDir(paths), 0o711),
        chmod(paths.roomRootDir, 0o711),
        chmod(paths.runtimeDir, 0o700),
        chmod(paths.runtimeSecretsDir, 0o700),
        chmod(paths.engineStateDir, 0o711),
    ])
    await Promise.all(
        [paths.workspaceDir, paths.storeDir, homeDir, tmpDir].map((path) =>
            chownTree(path, identity.uid, identity.gid),
        ),
    )
}

export async function ensureMaterializedRuntimeSandboxFile(
    paths: RoomPaths,
    path: string,
): Promise<void> {
    const identity = materializedOrDisabledIdentity(
        await readMaterializedRuntimeSandboxIdentity(paths),
    )
    await ensureRoomRootForMaterializedPath(paths, identity)
    await ensureSandboxOwnedFile({
        path,
        roots: runtimeShellWritableRoots(paths),
        identity,
    })
}

export async function ensureMaterializedRuntimeSandboxDirectory(
    paths: RoomPaths,
    path: string,
): Promise<void> {
    const identity = materializedOrDisabledIdentity(
        await readMaterializedRuntimeSandboxIdentity(paths),
    )
    await ensureRoomRootForMaterializedPath(paths, identity)
    await ensureSandboxOwnedDirectory({
        path,
        roots: runtimeShellWritableRoots(paths),
        identity,
    })
}
