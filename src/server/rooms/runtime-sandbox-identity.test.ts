import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { spawn } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import type { RoomPaths, RoomRuntimeMetadataRecord, RuntimeSandboxIdentity } from '../domain/types'
import {
    __testing,
    applyRuntimeSandboxFilesystemOwnership,
    deterministicRoomSandboxName,
    materializeRuntimeSandboxIdentity,
    runtimeSandboxShellCommand,
} from './runtime-sandbox-identity'

function metadata(roomId: string): RoomRuntimeMetadataRecord {
    return {
        roomId,
        port: null,
        pid: null,
        sandboxUid: null,
        sandboxGid: null,
        sandboxUserName: null,
        sandboxGroupName: null,
        configVersion: 1,
        tokenVersion: 1,
        healthStatus: 'unknown',
        startedAt: null,
        lastHealthAt: null,
        lastError: null,
        updatedAt: new Date(),
    }
}

function isRoot(): boolean {
    return typeof process.getuid === 'function' && process.getuid() === 0
}

function roomPaths(root: string, roomId: string): RoomPaths {
    const roomRootDir = join(root, roomId)
    const runtimeDir = join(roomRootDir, 'runtime')
    const engineStateDir = join(roomRootDir, 'pi-state')
    const storeDir = join(roomRootDir, 'store')
    return {
        roomRootDir,
        runtimeDir,
        runtimeLogsDir: join(runtimeDir, 'logs'),
        runtimeSecretsDir: join(runtimeDir, 'secrets'),
        engineStateDir,
        workspaceDir: join(roomRootDir, 'workspace'),
        storeDir,
        storeBlobsDir: join(storeDir, 'blobs'),
        storeManifestsDir: join(storeDir, 'manifests'),
        storeExportsDir: join(storeDir, 'exports'),
        runtimeConfigPath: join(runtimeDir, 'pi-runtime.config.json'),
        runtimeEnvPath: join(runtimeDir, 'pi-runtime.env'),
        runtimeLogPath: join(runtimeDir, 'pi-runtime.log'),
        runtimeMetadataPath: join(runtimeDir, 'runtime.json'),
        runtimeHealthPath: join(runtimeDir, 'health.json'),
        runtimeTokenPath: join(runtimeDir, 'token'),
    }
}

function runAs(input: { identity: RuntimeSandboxIdentity; cwd: string; command: string }): Promise<{
    exitCode: number | null
    output: string
}> {
    return new Promise((resolve, reject) => {
        const sandboxedCommand = runtimeSandboxShellCommand(input.command, input.identity)
        const child = spawn(sandboxedCommand.command, sandboxedCommand.args, {
            cwd: input.cwd,
            stdio: ['ignore', 'pipe', 'pipe'],
        })
        let output = ''
        child.stdout.on('data', (chunk) => {
            output += chunk.toString('utf8')
        })
        child.stderr.on('data', (chunk) => {
            output += chunk.toString('utf8')
        })
        child.on('error', reject)
        child.on('close', (exitCode) => {
            resolve({
                exitCode,
                output,
            })
        })
    })
}

async function writeOwnerOnlyFile(path: string, contents = 'private\n'): Promise<void> {
    await mkdir(dirname(path), {
        recursive: true,
    })
    await writeFile(path, contents, {
        encoding: 'utf8',
        mode: 0o600,
    })
    await chmod(path, 0o600)
}

async function expectDenied(input: {
    identity: RuntimeSandboxIdentity
    cwd: string
    command: string
}): Promise<void> {
    const result = await runAs(input)

    expect(result.exitCode).not.toBe(0)
    expect(result.output).toMatch(/Permission denied|cannot open directory|cannot touch/)
}

describe('runtime sandbox identity', () => {
    it('derives deterministic Linux-safe account names', () => {
        const name = deterministicRoomSandboxName('room-1')
        const numericId = __testing.deterministicRoomSandboxNumericId('room-1')

        expect(name).toMatch(/^ar-[a-f0-9]{24}$/)
        expect(deterministicRoomSandboxName('room-1')).toBe(name)
        expect(deterministicRoomSandboxName('room-2')).not.toBe(name)
        expect(numericId).toBeGreaterThanOrEqual(200_000)
        expect(numericId).toBeLessThan(400_200_000)
        expect(__testing.deterministicRoomSandboxNumericId('room-1')).toBe(numericId)
        expect(__testing.deterministicRoomSandboxNumericId('room-2')).not.toBe(numericId)
    })

    it('does not require a sandbox identity when shell tools are disabled', async () => {
        await expect(
            materializeRuntimeSandboxIdentity({
                roomId: 'room-1',
                current: metadata('room-1'),
                paths: roomPaths(tmpdir(), 'room-1'),
                sandboxRequired: false,
            }),
        ).resolves.toEqual({
            mode: 'disabled',
            uid: null,
            gid: null,
            userName: null,
            groupName: null,
        })
    })

    it('rejects persisted identity mismatches instead of silently changing users', () => {
        expect(() =>
            __testing.assertPersistedIdentityMatches(
                {
                    ...metadata('room-1'),
                    sandboxUid: 123,
                },
                {
                    mode: 'per-room',
                    uid: 456,
                    gid: 789,
                    userName: 'ar-example',
                    groupName: 'ar-example',
                },
            ),
        ).toThrow(/does not match/)
    })

    it('fails closed without root or the explicit test-only unsafe override', async () => {
        if (isRoot()) return

        await expect(
            materializeRuntimeSandboxIdentity({
                roomId: 'room-1',
                current: metadata('room-1'),
                paths: roomPaths(tmpdir(), 'room-1'),
                sandboxRequired: true,
            }),
        ).rejects.toThrow(/requires root privileges/)
    })

    it.runIf(isRoot())(
        'denies same-room runtime secrets and cross-room shell access by Unix permissions',
        async () => {
            const dataRoot = await mkdtemp(join(tmpdir(), 'agent-room-sandbox-'))
            const roomA = `sandbox-a-${Date.now()}`
            const roomB = `sandbox-b-${Date.now()}`
            try {
                const pathsA = roomPaths(dataRoot, roomA)
                const pathsB = roomPaths(dataRoot, roomB)
                const identityA = await materializeRuntimeSandboxIdentity({
                    roomId: roomA,
                    current: metadata(roomA),
                    paths: pathsA,
                    sandboxRequired: true,
                })
                const identityB = await materializeRuntimeSandboxIdentity({
                    roomId: roomB,
                    current: metadata(roomB),
                    paths: pathsB,
                    sandboxRequired: true,
                })
                await applyRuntimeSandboxFilesystemOwnership(pathsA, identityA)
                await applyRuntimeSandboxFilesystemOwnership(pathsB, identityB)

                expect(identityA.mode).toBe('per-room')
                expect(identityB.mode).toBe('per-room')
                if (identityA.mode !== 'per-room' || identityB.mode !== 'per-room') return
                expect(identityA.uid).toBe(__testing.deterministicRoomSandboxNumericId(roomA))
                expect(identityA.gid).toBe(identityA.uid)

                const sameRoomRuntimeFiles = [
                    pathsA.runtimeConfigPath,
                    pathsA.runtimeEnvPath,
                    pathsA.runtimeTokenPath,
                    join(pathsA.runtimeSecretsDir, 'provider.secret'),
                ]
                await Promise.all(
                    sameRoomRuntimeFiles.map((path) => writeOwnerOnlyFile(path, 'secret\n')),
                )

                const crossRoomDirs = [
                    pathsB.workspaceDir,
                    pathsB.storeDir,
                    pathsB.engineStateDir,
                    join(pathsB.engineStateDir, 'sessions'),
                    join(pathsB.engineStateDir, 'internal-state'),
                    join(pathsB.engineStateDir, 'home'),
                    join(pathsB.engineStateDir, 'tmp'),
                    pathsB.runtimeDir,
                    pathsB.runtimeSecretsDir,
                ]
                await Promise.all(
                    crossRoomDirs.map(async (path) => {
                        await mkdir(path, {
                            recursive: true,
                            mode: 0o700,
                        })
                        await writeOwnerOnlyFile(join(path, 'marker.txt'))
                    }),
                )

                expect(runtimeSandboxShellCommand('id', identityA)).toEqual({
                    command: 'setpriv',
                    args: [
                        '--reuid',
                        String(identityA.uid),
                        '--regid',
                        String(identityA.gid),
                        '--clear-groups',
                        '--no-new-privs',
                        '/bin/sh',
                        '-c',
                        'id',
                    ],
                })

                for (const path of sameRoomRuntimeFiles) {
                    await expectDenied({
                        identity: identityA,
                        cwd: pathsA.workspaceDir,
                        command: `cat ${JSON.stringify(path)}`,
                    })
                }

                for (const dir of crossRoomDirs) {
                    await expectDenied({
                        identity: identityA,
                        cwd: pathsA.workspaceDir,
                        command: `ls ${JSON.stringify(dir)}`,
                    })
                    await expectDenied({
                        identity: identityA,
                        cwd: pathsA.workspaceDir,
                        command: `cat ${JSON.stringify(join(dir, 'marker.txt'))}`,
                    })
                    await expectDenied({
                        identity: identityA,
                        cwd: pathsA.workspaceDir,
                        command: `touch ${JSON.stringify(join(dir, 'denied.txt'))}`,
                    })
                }
            } finally {
                await rm(dataRoot, {
                    recursive: true,
                    force: true,
                })
            }
        },
        30_000,
    )
})
