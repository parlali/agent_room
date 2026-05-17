import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { chmod, chown, lchown, lstat, mkdir, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'
import type { RoomPaths, RoomRuntimeMetadataRecord, RuntimeSandboxIdentity } from '../domain/types'

const execFileAsync = promisify(execFile)
const nologinShell = '/usr/sbin/nologin'

interface PasswdEntry {
    name: string
    uid: number
    gid: number
}

interface GroupEntry {
    name: string
    gid: number
}

function isRootProcess(): boolean {
    return typeof process.getuid === 'function' && process.getuid() === 0
}

function testUnsafeSandboxAllowed(): boolean {
    return (
        process.env.NODE_ENV === 'test' &&
        process.env.AGENT_ROOM_UNSAFE_ALLOW_UNSANDBOXED_SHELL === '1'
    )
}

function parseId(value: string): number | null {
    const parsed = Number(value)
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null
}

export function deterministicRoomSandboxName(roomId: string): string {
    const hash = createHash('sha256').update(roomId).digest('hex').slice(0, 24)
    return `ar-${hash}`
}

async function execAccountCommand(command: string, args: string[]): Promise<string | null> {
    try {
        const result = await execFileAsync(command, args, {
            encoding: 'utf8',
        })
        return result.stdout.trim()
    } catch {
        return null
    }
}

async function lookupUser(userName: string): Promise<PasswdEntry | null> {
    const output = await execAccountCommand('getent', ['passwd', userName])
    if (!output) return null
    const [name, , uidText, gidText] = output.split(':')
    const uid = parseId(uidText ?? '')
    const gid = parseId(gidText ?? '')
    if (!name || uid === null || gid === null) return null
    return {
        name,
        uid,
        gid,
    }
}

async function lookupGroup(groupName: string): Promise<GroupEntry | null> {
    const output = await execAccountCommand('getent', ['group', groupName])
    if (!output) return null
    const [name, , gidText] = output.split(':')
    const gid = parseId(gidText ?? '')
    if (!name || gid === null) return null
    return {
        name,
        gid,
    }
}

async function ensureGroup(groupName: string): Promise<GroupEntry> {
    const existing = await lookupGroup(groupName)
    if (existing) return existing

    await execFileAsync('groupadd', ['--system', groupName])
    const created = await lookupGroup(groupName)
    if (!created) {
        throw new Error(`Failed to create sandbox group ${groupName}`)
    }
    return created
}

async function ensureUser(input: {
    userName: string
    groupName: string
    homeDir: string
}): Promise<PasswdEntry> {
    const existing = await lookupUser(input.userName)
    if (existing) return existing

    await execFileAsync('useradd', [
        '--system',
        '--gid',
        input.groupName,
        '--home-dir',
        input.homeDir,
        '--no-create-home',
        '--shell',
        nologinShell,
        input.userName,
    ])
    const created = await lookupUser(input.userName)
    if (!created) {
        throw new Error(`Failed to create sandbox user ${input.userName}`)
    }
    return created
}

function assertPersistedIdentityMatches(
    current: RoomRuntimeMetadataRecord,
    identity: RuntimeSandboxIdentity,
): void {
    if (identity.mode !== 'per-room') return
    const checks: Array<[unknown, unknown, string]> = [
        [current.sandboxUid, identity.uid, 'uid'],
        [current.sandboxGid, identity.gid, 'gid'],
        [current.sandboxUserName, identity.userName, 'user name'],
        [current.sandboxGroupName, identity.groupName, 'group name'],
    ]
    for (const [persisted, materialized, label] of checks) {
        if (persisted !== null && persisted !== materialized) {
            throw new Error(
                `Persisted sandbox ${label} does not match the OS account for this room`,
            )
        }
    }
}

export async function materializeRuntimeSandboxIdentity(input: {
    roomId: string
    current: RoomRuntimeMetadataRecord
    paths: RoomPaths
}): Promise<RuntimeSandboxIdentity> {
    if (testUnsafeSandboxAllowed()) {
        return {
            mode: 'test-unsafe',
            uid: null,
            gid: null,
            userName: null,
            groupName: null,
        }
    }

    if (!isRootProcess()) {
        throw new Error(
            'Runtime startup requires root privileges to obtain a per-room sandbox user. Disable runtime start or run Agent Room in the Docker image.',
        )
    }

    const defaultName = deterministicRoomSandboxName(input.roomId)
    const userName = input.current.sandboxUserName ?? defaultName
    const groupName = input.current.sandboxGroupName ?? defaultName
    const group = await ensureGroup(groupName)
    const user = await ensureUser({
        userName,
        groupName,
        homeDir: input.paths.engineStateDir,
    })
    if (user.gid !== group.gid) {
        throw new Error(`Sandbox user ${userName} is not bound to sandbox group ${groupName}`)
    }

    const identity: RuntimeSandboxIdentity = {
        mode: 'per-room',
        uid: user.uid,
        gid: group.gid,
        userName: user.name,
        groupName: group.name,
    }
    assertPersistedIdentityMatches(input.current, identity)
    return identity
}

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
        await Promise.all(entries.map((entry) => chownTree(join(path, entry.name), uid, gid)))
        await chmod(path, 0o700)
    }
    await chownPath(path, uid, gid)
}

export async function applyRuntimeSandboxFilesystemOwnership(
    paths: RoomPaths,
    identity: RuntimeSandboxIdentity,
): Promise<void> {
    if (identity.mode !== 'per-room') return
    await Promise.all([
        mkdir(paths.roomRootDir, { recursive: true, mode: 0o700 }),
        mkdir(paths.runtimeDir, { recursive: true, mode: 0o700 }),
        mkdir(paths.runtimeSecretsDir, { recursive: true, mode: 0o700 }),
        mkdir(paths.engineStateDir, { recursive: true, mode: 0o700 }),
        mkdir(paths.workspaceDir, { recursive: true, mode: 0o700 }),
        mkdir(paths.storeDir, { recursive: true, mode: 0o700 }),
    ])
    await Promise.all(
        [
            paths.roomRootDir,
            paths.runtimeDir,
            paths.runtimeSecretsDir,
            paths.engineStateDir,
            paths.workspaceDir,
            paths.storeDir,
        ].map((path) => chownTree(path, identity.uid, identity.gid)),
    )
}

export async function ensureRuntimeSandboxFile(
    path: string,
    identity: RuntimeSandboxIdentity,
): Promise<void> {
    await chmod(path, 0o600)
    if (identity.mode === 'per-room') {
        await chown(path, identity.uid, identity.gid)
    }
}

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

export const __testing = {
    deterministicRoomSandboxName,
    assertPersistedIdentityMatches,
}
