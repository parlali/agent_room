import { beforeEach, describe, expect, it, vi } from 'vitest'
import type * as RuntimeSupervisorBootstrap from './runtime-supervisor-bootstrap'

const mocks = vi.hoisted(() => ({
    listRooms: vi.fn(),
    reconcileRoom: vi.fn(),
}))

vi.mock('../db/repositories', () => ({
    roomRepository: {
        listRooms: mocks.listRooms,
    },
}))

vi.mock('./runtime-manager', () => ({
    roomRuntimeManager: {
        reconcileRoom: mocks.reconcileRoom,
    },
}))

describe('runtime supervisor bootstrap', () => {
    let ensureRuntimeSupervisorBoot: typeof RuntimeSupervisorBootstrap.ensureRuntimeSupervisorBoot
    let resetRuntimeSupervisorBoot: typeof RuntimeSupervisorBootstrap.__resetRuntimeSupervisorBootForTests

    beforeEach(async () => {
        vi.resetModules()
        mocks.listRooms.mockReset()
        mocks.reconcileRoom.mockReset()
        mocks.reconcileRoom.mockResolvedValue({
            started: false,
            restarted: false,
            blocked: false,
            skipped: true,
        })

        const module = await import('./runtime-supervisor-bootstrap')
        ensureRuntimeSupervisorBoot = module.ensureRuntimeSupervisorBoot
        resetRuntimeSupervisorBoot = module.__resetRuntimeSupervisorBootForTests
        resetRuntimeSupervisorBoot()
    })

    it('skips desired-running rooms that do not need reconciliation', async () => {
        mocks.listRooms.mockResolvedValue([
            {
                id: 'healthy-running',
                desiredState: 'running',
                status: 'running',
            },
            {
                id: 'blocked-running',
                desiredState: 'running',
                status: 'setup_required',
            },
            {
                id: 'healthy-stopped',
                desiredState: 'stopped',
                status: 'stopped',
            },
        ])

        await ensureRuntimeSupervisorBoot()

        expect(mocks.reconcileRoom).toHaveBeenCalledTimes(1)
        expect(mocks.reconcileRoom).toHaveBeenCalledWith('blocked-running', null)
    })
})
