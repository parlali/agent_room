import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { chmod, chown, lchown, lstat, mkdir, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'
import type { RoomPaths, RoomRuntimeMetadataRecord, RuntimeSandboxIdentity } from '../domain/types'

const execFileAsync = promisify(execFile)
const nologinShell = '/usr/sbin/nologin'
const sandboxIdBase = 200_000
const sandboxIdRange = 400_000_000

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

export function deterministicRoomSandboxNumericId(roomId: string): number {
    const hash = createHash('sha256').update(roomId).digest()
    const offset = hash.readUInt32BE(0) % sandboxIdRange
    return sandboxIdBase + offset
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

function parsePasswdEntry(output: string): PasswdEntry | null {
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

async function lookupUser(userName: string): Promise<PasswdEntry | null> {
    const output = await execAccountCommand('getent', ['passwd', userName])
    if (!output) return null
    return parsePasswdEntry(output)
}

async function lookupUserByUid(uid: number): Promise<PasswdEntry | null> {
    const output = await execAccountCommand('getent', ['passwd', String(uid)])
    if (!output) return null
    return parsePasswdEntry(output)
}

function parseGroupEntry(output: string): GroupEntry | null {
    const [name, , gidText] = output.split(':')
    const gid = parseId(gidText ?? '')
    if (!name || gid === null) return null
    return {
        name,
        gid,
    }
}

async function lookupGroup(groupName: string): Promise<GroupEntry | null> {
    const output = await execAccountCommand('getent', ['group', groupName])
    if (!output) return null
    return parseGroupEntry(output)
}

async function lookupGroupByGid(gid: number): Promise<GroupEntry | null> {
    const output = await execAccountCommand('getent', ['group', String(gid)])
    if (!output) return null
    return parseGroupEntry(output)
}

async function ensureGroup(groupName: string, gid: number): Promise<GroupEntry> {
    const existing = await lookupGroup(groupName)
    if (existing) {
        if (existing.gid !== gid) {
            throw new Error(`Sandbox group ${groupName} has gid ${existing.gid}, expected ${gid}`)
        }
        return existing
    }

    const existingByGid = await lookupGroupByGid(gid)
    if (existingByGid && existingByGid.name !== groupName) {
        throw new Error(
            `Sandbox gid ${gid} is already used by group ${existingByGid.name}, expected ${groupName}`,
        )
    }

    await execFileAsync('groupadd', ['--system', '--gid', String(gid), groupName])
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
    uid: number
    gid: number
}): Promise<PasswdEntry> {
    const existing = await lookupUser(input.userName)
    if (existing) {
        if (existing.uid !== input.uid || existing.gid !== input.gid) {
            throw new Error(
                `Sandbox user ${input.userName} has uid/gid ${existing.uid}/${existing.gid}, expected ${input.uid}/${input.gid}`,
            )
        }
        return existing
    }

    const existingByUid = await lookupUserByUid(input.uid)
    if (existingByUid && existingByUid.name !== input.userName) {
        throw new Error(
            `Sandbox uid ${input.uid} is already used by user ${existingByUid.name}, expected ${input.userName}`,
        )
    }

    await execFileAsync('useradd', [
        '--system',
        '--uid',
        String(input.uid),
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
    sandboxRequired: boolean
}): Promise<RuntimeSandboxIdentity> {
    if (!input.sandboxRequired) {
        return {
            mode: 'disabled',
            uid: null,
            gid: null,
            userName: null,
            groupName: null,
        }
    }

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
    const defaultNumericId = deterministicRoomSandboxNumericId(input.roomId)
    const userName = input.current.sandboxUserName ?? defaultName
    const groupName = input.current.sandboxGroupName ?? defaultName
    const uid = input.current.sandboxUid ?? defaultNumericId
    const gid = input.current.sandboxGid ?? uid
    const group = await ensureGroup(groupName, gid)
    const user = await ensureUser({
        userName,
        groupName,
        homeDir: input.paths.engineStateDir,
        uid,
        gid: group.gid,
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
    const homeDir = join(paths.engineStateDir, 'home')
    const tmpDir = join(paths.engineStateDir, 'tmp')
    await Promise.all([
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
    deterministicRoomSandboxNumericId,
    assertPersistedIdentityMatches,
}
