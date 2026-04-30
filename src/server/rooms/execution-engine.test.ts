import { beforeEach, describe, expect, it, vi } from 'vitest'
import type * as ExecutionEngine from './execution-engine'

const mocks = vi.hoisted(() => ({
    getRoomExecutionSnapshot: vi.fn(),
    sendRoomThreadMessage: vi.fn(),
    createRoomThread: vi.fn(),
    listRoomCronJobs: vi.fn(),
    updateRoomCronJob: vi.fn(),
}))

vi.mock('./pi-execution-adapter', () => ({
    listRoomsWithRuntime: vi.fn(),
    getRoomExecutionSnapshot: mocks.getRoomExecutionSnapshot,
    sendRoomThreadMessage: mocks.sendRoomThreadMessage,
    abortRoomThreadMessage: vi.fn(),
    editRoomThreadMessage: vi.fn(),
    createRoomSessionEventStream: vi.fn(),
    createRoomThread: mocks.createRoomThread,
    listRoomCronJobs: mocks.listRoomCronJobs,
    createRoomCronJob: vi.fn(),
    updateRoomCronJob: mocks.updateRoomCronJob,
    updateRoomCronJobEnabled: vi.fn(),
    runRoomCronJobNow: vi.fn(),
    removeRoomCronJob: vi.fn(),
    wakeRoomRuntime: vi.fn(),
    getRoomExecutionTruthSnapshot: vi.fn(),
    listRoomRunHistory: vi.fn(),
    runDueRoomCronJobs: vi.fn(),
}))

describe('runtime-neutral execution engine facade', () => {
    let engine: typeof ExecutionEngine

    beforeEach(async () => {
        vi.resetModules()
        mocks.getRoomExecutionSnapshot.mockReset()
        mocks.sendRoomThreadMessage.mockReset()
        mocks.createRoomThread.mockReset()
        mocks.listRoomCronJobs.mockReset()
        mocks.updateRoomCronJob.mockReset()
        engine = await import('./execution-engine')
    })

    it('routes snapshot, message, thread, and job calls through the adapter contract', async () => {
        mocks.getRoomExecutionSnapshot.mockResolvedValue({ selectedThreadKey: 'thread-1' })
        mocks.sendRoomThreadMessage.mockResolvedValue({ status: 'accepted' })
        mocks.createRoomThread.mockResolvedValue({ key: 'thread-2' })
        mocks.listRoomCronJobs.mockResolvedValue([])
        mocks.updateRoomCronJob.mockResolvedValue({ id: 'job-1' })

        await expect(
            engine.getRoomExecutionSnapshot({
                roomId: 'room-1',
                selectedThreadKey: 'thread-1',
            }),
        ).resolves.toEqual({ selectedThreadKey: 'thread-1' })
        await expect(
            engine.sendRoomThreadMessage({
                roomId: 'room-1',
                sessionKey: 'thread-1',
                message: 'hello',
                awaitCompletion: true,
            }),
        ).resolves.toEqual({ status: 'accepted' })
        await expect(engine.createRoomThread({ roomId: 'room-1' })).resolves.toEqual({
            key: 'thread-2',
        })
        await expect(engine.listRoomCronJobs({ roomId: 'room-1' })).resolves.toEqual([])
        await expect(
            engine.updateRoomCronJob({
                roomId: 'room-1',
                jobId: 'job-1',
                name: 'Digest',
                message: 'Summarize',
                everyMinutes: 30,
            }),
        ).resolves.toEqual({ id: 'job-1' })

        expect(mocks.getRoomExecutionSnapshot).toHaveBeenCalledWith({
            roomId: 'room-1',
            selectedThreadKey: 'thread-1',
        })
        expect(mocks.sendRoomThreadMessage).toHaveBeenCalledWith({
            roomId: 'room-1',
            sessionKey: 'thread-1',
            message: 'hello',
            awaitCompletion: true,
        })
        expect(mocks.createRoomThread).toHaveBeenCalledWith({ roomId: 'room-1' })
        expect(mocks.listRoomCronJobs).toHaveBeenCalledWith({ roomId: 'room-1' })
        expect(mocks.updateRoomCronJob).toHaveBeenCalledWith({
            roomId: 'room-1',
            jobId: 'job-1',
            name: 'Digest',
            message: 'Summarize',
            everyMinutes: 30,
        })
    })
})
