import { afterEach, describe, expect, it } from 'bun:test'
import { __testing } from './shell-sandbox'
import { piRuntimeVmIsolatedEnvKey } from '../rooms/pi-runtime-contract'

const assertIdentity = __testing.assertRuntimeSandboxIdentity

const disabledIdentity = {
    mode: 'disabled',
    uid: null,
    gid: null,
    userName: null,
    groupName: null,
} as const

const perRoomIdentity = {
    mode: 'per-room',
    uid: 1234,
    gid: 1234,
    userName: 'room-1234',
    groupName: 'room-1234',
} as const

describe('assertRuntimeSandboxIdentity', () => {
    afterEach(() => {
        delete process.env[piRuntimeVmIsolatedEnvKey]
    })

    it('accepts a per-room identity with a real uid and gid', () => {
        expect(() => assertIdentity(perRoomIdentity)).not.toThrow()
    })

    it('rejects a per-room identity without a materialized uid/gid', () => {
        expect(() =>
            assertIdentity({
                mode: 'per-room',
                uid: 0,
                gid: 0,
                userName: 'root',
                groupName: 'root',
            }),
        ).toThrow('per-room sandbox identity')
    })

    it('accepts a disabled identity when the deployment declares VM-level isolation', () => {
        process.env[piRuntimeVmIsolatedEnvKey] = '1'
        expect(() => assertIdentity(disabledIdentity)).not.toThrow()
    })

    it('fails closed on a disabled identity without declared VM-level isolation', () => {
        delete process.env[piRuntimeVmIsolatedEnvKey]
        expect(() => assertIdentity(disabledIdentity)).toThrow('failed closed')
    })
})
