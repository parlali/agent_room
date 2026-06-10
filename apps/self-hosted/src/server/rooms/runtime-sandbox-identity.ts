import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { promisify } from 'node:util'
import type {
    RoomPaths,
    RoomRuntimeMetadataRecord,
    RuntimeSandboxIdentity,
} from '#/domain/domain-types'

const execFileAsync = promisify(execFile)
const nologinShell = '/usr/sbin/nologin'
const sandboxIdBase = 200_000
const sandboxIdRange = 400_000_000
const sandboxIdCandidateLimit = 128

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

export function deterministicRoomSandboxNumericId(roomId: string, attempt = 0): number {
    const material = attempt === 0 ? roomId : `${roomId}:${attempt}`
    const hash = createHash('sha256').update(material).digest()
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

async function lookupExpectedGroup(groupName: string, gid: number): Promise<GroupEntry | null> {
    const byName = await lookupGroup(groupName)
    if (byName && byName.gid === gid) {
        return byName
    }
    const byGid = await lookupGroupByGid(gid)
    if (byGid && byGid.name === groupName) {
        return byGid
    }
    return null
}

async function lookupExpectedUser(input: {
    userName: string
    uid: number
    gid: number
}): Promise<PasswdEntry | null> {
    const byName = await lookupUser(input.userName)
    if (byName && byName.uid === input.uid && byName.gid === input.gid) {
        return byName
    }
    const byUid = await lookupUserByUid(input.uid)
    if (byUid && byUid.name === input.userName && byUid.gid === input.gid) {
        return byUid
    }
    return null
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

    try {
        await execFileAsync('groupadd', ['--system', '--gid', String(gid), groupName])
    } catch (error) {
        const raced = await lookupExpectedGroup(groupName, gid)
        if (raced) {
            return raced
        }
        throw new Error(
            `Sandbox group ${groupName} could not be materialized with gid ${gid}: ${error instanceof Error ? error.message : 'unknown error'}`,
        )
    }
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

    try {
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
    } catch (error) {
        const raced = await lookupExpectedUser(input)
        if (raced) {
            return raced
        }
        throw new Error(
            `Sandbox user ${input.userName} could not be materialized with uid/gid ${input.uid}/${input.gid}: ${error instanceof Error ? error.message : 'unknown error'}`,
        )
    }
    const created = await lookupUser(input.userName)
    if (!created) {
        throw new Error(`Failed to create sandbox user ${input.userName}`)
    }
    return created
}

async function existingNamedIdentity(
    userName: string,
    groupName: string,
): Promise<RuntimeSandboxIdentity | null> {
    const [user, group] = await Promise.all([lookupUser(userName), lookupGroup(groupName)])
    if (!user || !group || user.gid !== group.gid) {
        return null
    }
    return {
        mode: 'per-room',
        uid: user.uid,
        gid: group.gid,
        userName: user.name,
        groupName: group.name,
    }
}

async function sandboxNumericIdAvailable(input: {
    uid: number
    gid: number
    userName: string
    groupName: string
}): Promise<boolean> {
    const [user, group] = await Promise.all([
        lookupUserByUid(input.uid),
        lookupGroupByGid(input.gid),
    ])
    return (!user || user.name === input.userName) && (!group || group.name === input.groupName)
}

async function createSandboxIdentity(input: {
    userName: string
    groupName: string
    homeDir: string
    uid: number
    gid: number
}): Promise<RuntimeSandboxIdentity> {
    const group = await ensureGroup(input.groupName, input.gid)
    const user = await ensureUser({
        userName: input.userName,
        groupName: input.groupName,
        homeDir: input.homeDir,
        uid: input.uid,
        gid: group.gid,
    })
    if (user.gid !== group.gid) {
        throw new Error(
            `Sandbox user ${input.userName} is not bound to sandbox group ${input.groupName}`,
        )
    }
    return {
        mode: 'per-room',
        uid: user.uid,
        gid: group.gid,
        userName: user.name,
        groupName: group.name,
    }
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
    const userName = input.current.sandboxUserName ?? defaultName
    const groupName = input.current.sandboxGroupName ?? defaultName

    if (input.current.sandboxUid !== null || input.current.sandboxGid !== null) {
        const uid = input.current.sandboxUid ?? deterministicRoomSandboxNumericId(input.roomId)
        const gid = input.current.sandboxGid ?? uid
        const identity = await createSandboxIdentity({
            userName,
            groupName,
            homeDir: input.paths.engineStateDir,
            uid,
            gid,
        })
        assertPersistedIdentityMatches(input.current, identity)
        return identity
    }

    const existing = await existingNamedIdentity(userName, groupName)
    if (existing) {
        assertPersistedIdentityMatches(input.current, existing)
        return existing
    }

    for (let attempt = 0; attempt < sandboxIdCandidateLimit; attempt += 1) {
        const uid = deterministicRoomSandboxNumericId(input.roomId, attempt)
        const gid = uid
        if (
            !(await sandboxNumericIdAvailable({
                uid,
                gid,
                userName,
                groupName,
            }))
        ) {
            continue
        }
        const identity = await createSandboxIdentity({
            userName,
            groupName,
            homeDir: input.paths.engineStateDir,
            uid,
            gid,
        })
        assertPersistedIdentityMatches(input.current, identity)
        return identity
    }

    throw new Error(`No available sandbox UID/GID candidate for room ${input.roomId}`)
}

export {
    applyRuntimeSandboxFilesystemOwnership,
    ensureMaterializedRuntimeSandboxDirectory,
    ensureMaterializedRuntimeSandboxFile,
} from './runtime-sandbox-filesystem'
export { runtimeSandboxShellCommand, runtimeSandboxSpawnCommand } from './runtime-sandbox-command'
export { readMaterializedRuntimeSandboxIdentity } from './runtime-sandbox-materialized'

export const __testing = {
    deterministicRoomSandboxName,
    deterministicRoomSandboxNumericId,
    assertPersistedIdentityMatches,
}
