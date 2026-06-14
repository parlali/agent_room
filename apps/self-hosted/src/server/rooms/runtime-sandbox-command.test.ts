import { describe, expect, it } from 'vitest'
import type { RuntimeSandboxIdentity, RuntimeSandboxResourceLimits } from '#/domain/domain-types'
import {
    buildResourceLimitArgs,
    runtimeSandboxShellCommand,
    runtimeSandboxSpawnCommand,
} from './runtime-sandbox-command'

const perRoomIdentity: RuntimeSandboxIdentity = {
    mode: 'per-room',
    uid: 424242,
    gid: 424242,
    userName: 'ar-test',
    groupName: 'ar-test',
}

const testUnsafeIdentity: RuntimeSandboxIdentity = {
    mode: 'test-unsafe',
    uid: null,
    gid: null,
    userName: null,
    groupName: null,
}

const noLimits: RuntimeSandboxResourceLimits = {
    cpuSeconds: null,
    addressSpaceBytes: null,
    fileSizeBytes: null,
    processCount: null,
    openFiles: null,
}

describe('buildResourceLimitArgs', () => {
    it('always disables core dumps and omits unset limits', () => {
        expect(buildResourceLimitArgs(noLimits)).toEqual(['--core=0'])
    })

    it('emits a flag for every configured limit', () => {
        expect(
            buildResourceLimitArgs({
                cpuSeconds: 60,
                addressSpaceBytes: 4294967296,
                fileSizeBytes: 2147483648,
                processCount: 1024,
                openFiles: 4096,
            }),
        ).toEqual([
            '--core=0',
            '--cpu=60',
            '--fsize=2147483648',
            '--as=4294967296',
            '--nproc=1024',
            '--nofile=4096',
        ])
    })
})

describe('runtimeSandboxSpawnCommand', () => {
    it('wraps setpriv with prlimit when limits are provided for a per-room identity', () => {
        expect(
            runtimeSandboxSpawnCommand('id', ['-u'], perRoomIdentity, {
                ...noLimits,
                processCount: 8192,
            }),
        ).toEqual({
            command: 'prlimit',
            args: [
                '--core=0',
                '--nproc=8192',
                '--',
                'setpriv',
                '--reuid',
                '424242',
                '--regid',
                '424242',
                '--clear-groups',
                '--no-new-privs',
                'id',
                '-u',
            ],
        })
    })

    it('drops privileges without prlimit when no limits are provided', () => {
        expect(runtimeSandboxSpawnCommand('id', [], perRoomIdentity)).toEqual({
            command: 'setpriv',
            args: [
                '--reuid',
                '424242',
                '--regid',
                '424242',
                '--clear-groups',
                '--no-new-privs',
                'id',
            ],
        })
    })

    it('does not wrap commands for a non per-room identity', () => {
        expect(
            runtimeSandboxSpawnCommand('id', [], testUnsafeIdentity, {
                ...noLimits,
                processCount: 8192,
            }),
        ).toEqual({
            command: 'id',
            args: [],
        })
    })
})

describe('runtimeSandboxShellCommand', () => {
    it('runs the shell through prlimit and setpriv when limits are provided', () => {
        expect(
            runtimeSandboxShellCommand('echo hi', perRoomIdentity, {
                ...noLimits,
                processCount: 8192,
            }),
        ).toEqual({
            command: 'prlimit',
            args: [
                '--core=0',
                '--nproc=8192',
                '--',
                'setpriv',
                '--reuid',
                '424242',
                '--regid',
                '424242',
                '--clear-groups',
                '--no-new-privs',
                '/bin/sh',
                '-c',
                'echo hi',
            ],
        })
    })
})
