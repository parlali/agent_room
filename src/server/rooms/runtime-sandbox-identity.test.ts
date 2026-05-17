import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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

describe('runtime sandbox identity', () => {
    it('derives deterministic Linux-safe account names', () => {
        const name = deterministicRoomSandboxName('room-1')

        expect(name).toMatch(/^ar-[a-f0-9]{24}$/)
        expect(deterministicRoomSandboxName('room-1')).toBe(name)
        expect(deterministicRoomSandboxName('room-2')).not.toBe(name)
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
            }),
        ).rejects.toThrow(/requires root privileges/)
    })

    it.runIf(isRoot())(
        'denies cross-room shell reads by Unix permissions',
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
                })
                const identityB = await materializeRuntimeSandboxIdentity({
                    roomId: roomB,
                    current: metadata(roomB),
                    paths: pathsB,
                })
                await applyRuntimeSandboxFilesystemOwnership(pathsA, identityA)
                await applyRuntimeSandboxFilesystemOwnership(pathsB, identityB)

                expect(identityA.mode).toBe('per-room')
                expect(identityB.mode).toBe('per-room')
                if (identityA.mode !== 'per-room' || identityB.mode !== 'per-room') return

                const denial = await runAs({
                    identity: identityA,
                    cwd: pathsA.workspaceDir,
                    command: `ls ${JSON.stringify(pathsB.workspaceDir)}`,
                })

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
                expect(denial.exitCode).not.toBe(0)
                expect(denial.output).toMatch(/Permission denied|cannot open directory/)
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
