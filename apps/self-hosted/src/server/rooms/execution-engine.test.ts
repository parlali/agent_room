import { beforeEach, describe, expect, it, vi } from 'vitest'
import type * as ExecutionEngine from './execution-engine'

const mocks = vi.hoisted(() => ({
    getRoomExecutionSnapshot: vi.fn(),
    sendRoomThreadMessage: vi.fn(),
    updateRoomThreadModel: vi.fn(),
    compactRoomThread: vi.fn(),
    forkRoomThread: vi.fn(),
    editRoomThreadMessage: vi.fn(),
    createRoomThread: vi.fn(),
    listRoomCronJobs: vi.fn(),
    updateRoomCronJob: vi.fn(),
    publishRoomFileChanged: vi.fn(),
}))

vi.mock('./pi-execution-adapter', () => ({
    listRoomsWithRuntime: vi.fn(),
    getRoomExecutionSnapshot: mocks.getRoomExecutionSnapshot,
    sendRoomThreadMessage: mocks.sendRoomThreadMessage,
    updateRoomThreadModel: mocks.updateRoomThreadModel,
    abortRoomThreadMessage: vi.fn(),
    compactRoomThread: mocks.compactRoomThread,
    forkRoomThread: mocks.forkRoomThread,
    editRoomThreadMessage: mocks.editRoomThreadMessage,
    createRoomSessionEventStream: vi.fn(),
    createRoomEventStream: vi.fn(),
    publishRoomFileChanged: mocks.publishRoomFileChanged,
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
        mocks.updateRoomThreadModel.mockReset()
        mocks.compactRoomThread.mockReset()
        mocks.forkRoomThread.mockReset()
        mocks.editRoomThreadMessage.mockReset()
        mocks.createRoomThread.mockReset()
        mocks.listRoomCronJobs.mockReset()
        mocks.updateRoomCronJob.mockReset()
        mocks.publishRoomFileChanged.mockReset()
        engine = await import('./execution-engine')
    })

    it('routes snapshot, message, thread, and job calls through the adapter contract', async () => {
        mocks.getRoomExecutionSnapshot.mockResolvedValue({ selectedThreadKey: 'thread-1' })
        mocks.sendRoomThreadMessage.mockResolvedValue({ status: 'accepted' })
        mocks.updateRoomThreadModel.mockResolvedValue({
            provider: 'openai-codex',
            model: 'gpt-5.5',
            value: 'openai-codex/gpt-5.5',
            label: 'GPT-5.5',
            thinkingLevel: 'xhigh',
            availableThinkingLevels: ['off', 'minimal', 'low', 'medium', 'high', 'xhigh'],
            speedMode: 'fast',
            availableSpeedModes: ['normal', 'fast'],
            options: [],
        })
        mocks.compactRoomThread.mockResolvedValue({ status: 'idle' })
        mocks.forkRoomThread.mockResolvedValue({ key: 'thread-fork' })
        mocks.editRoomThreadMessage.mockResolvedValue({ status: 'accepted' })
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
        await expect(
            engine.updateRoomThreadModel({
                roomId: 'room-1',
                sessionKey: 'thread-1',
                provider: 'openai-codex',
                model: 'gpt-5.5',
                thinkingLevel: 'xhigh',
            }),
        ).resolves.toEqual({
            provider: 'openai-codex',
            model: 'gpt-5.5',
            value: 'openai-codex/gpt-5.5',
            label: 'GPT-5.5',
            thinkingLevel: 'xhigh',
            availableThinkingLevels: ['off', 'minimal', 'low', 'medium', 'high', 'xhigh'],
            speedMode: 'fast',
            availableSpeedModes: ['normal', 'fast'],
            options: [],
        })
        await expect(
            engine.compactRoomThread({
                roomId: 'room-1',
                sessionKey: 'thread-1',
                instructions: 'keep decisions',
            }),
        ).resolves.toEqual({ status: 'idle' })
        await expect(
            engine.forkRoomThread({
                roomId: 'room-1',
                sessionKey: 'thread-1',
                title: 'Forked',
            }),
        ).resolves.toEqual({ key: 'thread-fork' })
        await expect(
            engine.editRoomThreadMessage({
                roomId: 'room-1',
                sessionKey: 'thread-1',
                messageId: 'message-1',
                message: 'retry',
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
                schedule: {
                    type: 'interval',
                    every: 30,
                    unit: 'minutes',
                },
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
        expect(mocks.updateRoomThreadModel).toHaveBeenCalledWith({
            roomId: 'room-1',
            sessionKey: 'thread-1',
            provider: 'openai-codex',
            model: 'gpt-5.5',
            thinkingLevel: 'xhigh',
        })
        expect(mocks.compactRoomThread).toHaveBeenCalledWith({
            roomId: 'room-1',
            sessionKey: 'thread-1',
            instructions: 'keep decisions',
        })
        expect(mocks.forkRoomThread).toHaveBeenCalledWith({
            roomId: 'room-1',
            sessionKey: 'thread-1',
            title: 'Forked',
        })
        expect(mocks.editRoomThreadMessage).toHaveBeenCalledWith({
            roomId: 'room-1',
            sessionKey: 'thread-1',
            messageId: 'message-1',
            message: 'retry',
        })
        expect(mocks.createRoomThread).toHaveBeenCalledWith({ roomId: 'room-1' })
        expect(mocks.listRoomCronJobs).toHaveBeenCalledWith({ roomId: 'room-1' })
        expect(mocks.updateRoomCronJob).toHaveBeenCalledWith({
            roomId: 'room-1',
            jobId: 'job-1',
            name: 'Digest',
            message: 'Summarize',
            schedule: {
                type: 'interval',
                every: 30,
                unit: 'minutes',
            },
        })
    })
})
