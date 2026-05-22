import { EventEmitter } from 'node:events'
import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import type { WriteStream } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RoomRecord } from '#/domain/domain-types'
import { __testing, stopRoomProcess } from './runtime-lifecycle'
import { deleteRuntimeProcess, setRuntimeProcess } from './runtime-process-store'

const mocks = vi.hoisted(() => ({
    appendEvent: vi.fn(),
    findRoomById: vi.fn(),
    findRuntimeMetadataByRoomId: vi.fn(),
    upsertRuntimeMetadata: vi.fn(),
}))

vi.mock('../db/repositories', () => ({
    auditRepository: {
        appendEvent: mocks.appendEvent,
    },
    roomRepository: {
        findRoomById: mocks.findRoomById,
        updateRoomStatus: vi.fn(),
    },
    roomRuntimeMetadataRepository: {
        findByRoomId: mocks.findRuntimeMetadataByRoomId,
        upsert: mocks.upsertRuntimeMetadata,
    },
}))

function fakeChild() {
    const emitter = new EventEmitter() as EventEmitter & {
        exitCode: number | null
        signalCode: NodeJS.Signals | null
        pid: number
        kill: ReturnType<typeof vi.fn>
    }
    emitter.exitCode = null
    emitter.signalCode = null
    emitter.pid = 12345
    emitter.kill = vi.fn(() => true)
    return emitter as unknown as ChildProcessWithoutNullStreams
}

describe('runtime lifecycle', () => {
    let root: string
    let previousDataDir: string | undefined

    beforeEach(() => {
        mocks.appendEvent.mockReset()
        mocks.appendEvent.mockResolvedValue(undefined)
        mocks.findRoomById.mockReset()
        mocks.findRoomById.mockResolvedValue(null)
        mocks.findRuntimeMetadataByRoomId.mockReset()
        mocks.findRuntimeMetadataByRoomId.mockResolvedValue(null)
        mocks.upsertRuntimeMetadata.mockReset()
        mocks.upsertRuntimeMetadata.mockImplementation((input) =>
            Promise.resolve({
                ...input,
                updatedAt: new Date(),
            }),
        )
    })

    beforeEach(async () => {
        root = await mkdtemp(join(tmpdir(), 'agent-room-runtime-lifecycle-'))
        previousDataDir = process.env.AGENT_ROOM_DATA_DIR
        process.env.AGENT_ROOM_DATA_DIR = root
    })

    afterEach(async () => {
        if (previousDataDir === undefined) {
            delete process.env.AGENT_ROOM_DATA_DIR
        } else {
            process.env.AGENT_ROOM_DATA_DIR = previousDataDir
        }
        deleteRuntimeProcess('room-stop-race')
        await rm(root, {
            recursive: true,
            force: true,
        })
    })

    it('waits for a registered runtime process to exit before stop resolves', async () => {
        const child = fakeChild()
        const healthTimer = setInterval(() => {}, 1000)
        healthTimer.unref()
        setRuntimeProcess('room-stop-race', {
            child,
            healthTimer,
            port: 31234,
            logStream: {
                end: vi.fn(),
            } as unknown as WriteStream,
        })

        let resolved = false
        const stopped = stopRoomProcess('room-stop-race', 'user-1').then(() => {
            resolved = true
        })

        await new Promise((resolve) => setTimeout(resolve, 10))

        expect(child.kill).toHaveBeenCalledWith('SIGTERM')
        expect(resolved).toBe(false)

        const childEvents = child as unknown as EventEmitter
        childEvents.emit('exit', 0, null)
        await stopped

        expect(resolved).toBe(true)
        expect(mocks.appendEvent).toHaveBeenCalledWith({
            actorUserId: 'user-1',
            roomId: 'room-stop-race',
            action: 'room.runtime_stopped',
            payload: {
                wasRunning: true,
            },
        })
    })

    it('restarts after a stopped exit when desired state is running', async () => {
        const room: RoomRecord = {
            id: 'room-restart',
            slug: 'restart',
            displayName: 'Restart',
            status: 'stopped',
            desiredState: 'running',
            createdByUserId: 'user-1',
            createdAt: new Date(),
            updatedAt: new Date(),
        }
        const restart = vi.fn().mockResolvedValue(undefined)
        mocks.findRoomById.mockResolvedValue(room)

        await expect(
            __testing.restartRoomIfDesiredAfterStop({
                roomId: 'room-restart',
                restart,
            }),
        ).resolves.toBe(true)

        expect(restart).toHaveBeenCalledWith(room)
        expect(mocks.appendEvent).toHaveBeenCalledWith({
            actorUserId: null,
            roomId: 'room-restart',
            action: 'room.runtime_restart_after_stop',
            payload: {},
        })
    })

    it('does not restart after a stopped exit when desired state remains stopped', async () => {
        const restart = vi.fn().mockResolvedValue(undefined)
        mocks.findRoomById.mockResolvedValue({
            id: 'room-restart',
            desiredState: 'stopped',
        })

        await expect(
            __testing.restartRoomIfDesiredAfterStop({
                roomId: 'room-restart',
                restart,
            }),
        ).resolves.toBe(false)

        expect(restart).not.toHaveBeenCalled()
    })

    it('persists recovered sandbox identity when stopping a materialized runtime', async () => {
        mocks.findRuntimeMetadataByRoomId.mockResolvedValue({
            roomId: 'room-stop-race',
            port: 31234,
            pid: null,
            sandboxUid: 200001,
            sandboxGid: 200001,
            sandboxUserName: 'ar-room',
            sandboxGroupName: 'ar-room',
            configVersion: 3,
            tokenVersion: 4,
            healthStatus: 'healthy',
            startedAt: new Date(),
            lastHealthAt: new Date(),
            lastError: null,
            updatedAt: new Date(),
        })

        await stopRoomProcess('room-stop-race', 'user-1')

        expect(mocks.upsertRuntimeMetadata).toHaveBeenLastCalledWith(
            expect.objectContaining({
                roomId: 'room-stop-race',
                pid: null,
                sandboxUid: 200001,
                sandboxGid: 200001,
                sandboxUserName: 'ar-room',
                sandboxGroupName: 'ar-room',
                configVersion: 3,
                tokenVersion: 4,
                healthStatus: 'unknown',
            }),
        )
    })
})
