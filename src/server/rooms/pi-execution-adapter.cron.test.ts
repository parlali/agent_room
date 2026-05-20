import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
    blockedConfig,
    cronJob,
    cronRun,
    mocks,
    now,
    readyConfig,
} from './pi-execution-adapter.cron.test.fixtures'

describe('Pi cron adapter', () => {
    beforeEach(() => {
        vi.useFakeTimers()
        vi.setSystemTime(now)
        for (const repository of [
            mocks.roomCronRepository,
            mocks.roomRepository,
            mocks.roomRuntimeMetadataRepository,
            mocks.usageRepository,
        ]) {
            for (const value of Object.values(repository)) {
                value.mockReset()
            }
        }
        mocks.getRoomConfigSnapshot.mockReset()
        mocks.requestPiRuntime.mockReset()
        mocks.openPiRuntimeEventStream.mockReset()
    })

    afterEach(() => {
        vi.useRealTimers()
    })

    it('creates cron jobs with provider, model, and config snapshots', async () => {
        mocks.getRoomConfigSnapshot.mockResolvedValue(readyConfig())
        mocks.roomRuntimeMetadataRepository.findByRoomId.mockResolvedValue({
            configVersion: 7,
        })
        mocks.roomCronRepository.createJob.mockImplementation(async (input) =>
            cronJob({
                name: input.name,
                message: input.message,
                everyMinutes: input.everyMinutes,
                schedule: input.schedule,
                nextRunAt: input.nextRunAt,
                provider: input.provider,
                model: input.model,
                configVersion: input.configVersion,
            }),
        )

        const adapter = await import('./pi-execution-adapter')
        const job = await adapter.createRoomCronJob({
            roomId: '22222222-2222-4222-8222-222222222222',
            name: ' Digest ',
            message: ' Summarize today ',
            schedule: {
                type: 'interval',
                every: 15,
                unit: 'minutes',
            },
        })

        expect(job.name).toBe('Digest')
        expect(mocks.roomCronRepository.createJob).toHaveBeenCalledWith(
            expect.objectContaining({
                roomId: '22222222-2222-4222-8222-222222222222',
                name: 'Digest',
                message: 'Summarize today',
                everyMinutes: 15,
                schedule: {
                    type: 'interval',
                    every: 15,
                    unit: 'minutes',
                },
                timezone: 'UTC',
                provider: 'openrouter',
                model: 'openrouter/google/gemini-2.5-pro',
                configVersion: 7,
            }),
        )
    })

    it('runs due cron jobs through the same thread create and send path', async () => {
        const job = cronJob()
        mocks.roomCronRepository.claimDueJobs.mockResolvedValue([job])
        mocks.getRoomConfigSnapshot.mockResolvedValue(readyConfig())
        mocks.roomRuntimeMetadataRepository.findByRoomId.mockResolvedValue({
            configVersion: 8,
        })
        mocks.roomCronRepository.createRun.mockResolvedValue(cronRun({ configVersion: 8 }))
        mocks.roomCronRepository.finishRun.mockResolvedValue(
            cronRun({
                status: 'complete',
                configVersion: 8,
                finishedAt: now,
            }),
        )
        mocks.roomCronRepository.finishJob.mockResolvedValue(
            cronJob({
                lastRunStatus: 'complete',
                configVersion: 8,
            }),
        )
        mocks.requestPiRuntime.mockImplementation(async (_roomId, path) => {
            if (path === '/threads') {
                return { key: 'thread-1' }
            }
            if (path === '/threads/thread-1/send') {
                return { status: 'accepted' }
            }
            throw new Error(`Unexpected runtime path ${path}`)
        })

        const adapter = await import('./pi-execution-adapter')
        await expect(adapter.runDueRoomCronJobs({ limit: 50 })).resolves.toEqual([
            {
                jobId: job.id,
                ran: true,
                reason: null,
            },
        ])

        expect(mocks.roomCronRepository.claimDueJobs).toHaveBeenCalledWith(
            expect.objectContaining({
                limit: 25,
            }),
        )
        expect(mocks.requestPiRuntime).toHaveBeenCalledWith(
            job.roomId,
            '/threads',
            expect.anything(),
            expect.objectContaining({
                method: 'POST',
            }),
        )
        expect(mocks.requestPiRuntime).toHaveBeenCalledWith(
            job.roomId,
            '/threads/thread-1/send',
            expect.anything(),
            expect.objectContaining({
                method: 'POST',
                body: expect.objectContaining({
                    message: 'Summarize today',
                    awaitCompletion: true,
                    runKind: 'scheduled',
                }),
            }),
        )
        expect(mocks.roomCronRepository.createRun).toHaveBeenCalledWith(
            expect.objectContaining({
                jobId: job.id,
                jobName: 'Digest',
                status: 'running',
                provider: 'openrouter',
                model: 'openrouter/google/gemini-2.5-pro',
                configVersion: 8,
            }),
        )
        expect(mocks.roomCronRepository.finishRun).toHaveBeenCalledWith(
            expect.objectContaining({
                status: 'complete',
            }),
        )
        expect(mocks.roomCronRepository.finishJob).toHaveBeenCalledWith(
            expect.objectContaining({
                status: 'complete',
            }),
        )
    })

    it('updates existing cron jobs without replacing job identity', async () => {
        const existing = cronJob({
            enabled: false,
            configVersion: 3,
        })
        mocks.roomCronRepository.findJobById.mockResolvedValue(existing)
        mocks.getRoomConfigSnapshot.mockResolvedValue(readyConfig())
        mocks.roomRuntimeMetadataRepository.findByRoomId.mockResolvedValue({
            configVersion: 10,
        })
        mocks.roomCronRepository.updateJob.mockImplementation(async (input) =>
            cronJob({
                id: existing.id,
                name: input.name,
                message: input.message,
                enabled: false,
                everyMinutes: input.everyMinutes,
                schedule: input.schedule,
                nextRunAt: input.nextRunAt,
                provider: input.provider,
                model: input.model,
                configVersion: input.configVersion,
            }),
        )

        const adapter = await import('./pi-execution-adapter')
        await expect(
            adapter.updateRoomCronJob({
                roomId: existing.roomId,
                jobId: existing.id,
                name: ' Updated digest ',
                message: ' Updated prompt ',
                schedule: {
                    type: 'interval',
                    every: 45,
                    unit: 'minutes',
                },
            }),
        ).resolves.toMatchObject({
            id: existing.id,
            name: 'Updated digest',
            payloadSummary: 'Updated prompt',
            nextRunAt: null,
        })

        expect(mocks.roomCronRepository.updateJob).toHaveBeenCalledWith(
            expect.objectContaining({
                roomId: existing.roomId,
                jobId: existing.id,
                name: 'Updated digest',
                message: 'Updated prompt',
                everyMinutes: 45,
                schedule: {
                    type: 'interval',
                    every: 45,
                    unit: 'minutes',
                },
                nextRunAt: null,
                provider: 'openrouter',
                model: 'openrouter/google/gemini-2.5-pro',
                configVersion: 10,
            }),
        )
    })

    it('records a failed run without touching Pi when the room config is blocked', async () => {
        const job = cronJob()
        mocks.roomCronRepository.claimDueJobs.mockResolvedValue([job])
        mocks.getRoomConfigSnapshot.mockResolvedValue(blockedConfig())
        mocks.roomRuntimeMetadataRepository.findByRoomId.mockResolvedValue({
            configVersion: 9,
        })
        mocks.roomCronRepository.createRun.mockResolvedValue(
            cronRun({
                status: 'failed',
                sessionKey: null,
                configVersion: 9,
                error: 'Room configuration is blocked: Provider validation failed',
            }),
        )
        mocks.roomCronRepository.finishJob.mockResolvedValue(
            cronJob({
                lastRunStatus: 'failed',
                configVersion: 9,
            }),
        )

        const adapter = await import('./pi-execution-adapter')
        await expect(adapter.runDueRoomCronJobs()).resolves.toEqual([
            {
                jobId: job.id,
                ran: false,
                reason: 'Room configuration is blocked: Provider validation failed',
            },
        ])

        expect(mocks.requestPiRuntime).not.toHaveBeenCalled()
        expect(mocks.roomCronRepository.createRun).toHaveBeenCalledWith(
            expect.objectContaining({
                jobId: job.id,
                jobName: 'Digest',
                status: 'failed',
                error: 'Room configuration is blocked: Provider validation failed',
                sessionKey: null,
                provider: 'openrouter',
                model: 'openrouter/google/gemini-2.5-pro',
                configVersion: 9,
            }),
        )
        expect(mocks.roomCronRepository.finishJob).toHaveBeenCalledWith(
            expect.objectContaining({
                status: 'failed',
                error: 'Room configuration is blocked: Provider validation failed',
            }),
        )
    })

    it('marks cron runs failed when Pi accepts the prompt but the turn ends in runtime error', async () => {
        const job = cronJob()
        mocks.roomCronRepository.claimDueJobs.mockResolvedValue([job])
        mocks.getRoomConfigSnapshot.mockResolvedValue(readyConfig())
        mocks.roomRuntimeMetadataRepository.findByRoomId.mockResolvedValue({
            configVersion: 8,
        })
        mocks.roomCronRepository.createRun.mockResolvedValue(cronRun({ configVersion: 8 }))
        mocks.roomCronRepository.finishRun.mockResolvedValue(
            cronRun({
                status: 'failed',
                configVersion: 8,
                finishedAt: now,
                error: 'provider failed',
            }),
        )
        mocks.roomCronRepository.finishJob.mockResolvedValue(
            cronJob({
                lastRunStatus: 'failed',
                configVersion: 8,
                lastError: 'provider failed',
            }),
        )
        mocks.requestPiRuntime.mockImplementation(async (_roomId, path) => {
            if (path === '/threads') {
                return { key: 'thread-1' }
            }
            if (path === '/threads/thread-1/send') {
                return {
                    status: 'error',
                    error: 'provider failed',
                }
            }
            throw new Error(`Unexpected runtime path ${path}`)
        })

        const adapter = await import('./pi-execution-adapter')
        await expect(adapter.runDueRoomCronJobs()).resolves.toEqual([
            {
                jobId: job.id,
                ran: false,
                reason: 'provider failed',
            },
        ])

        expect(mocks.roomCronRepository.finishRun).toHaveBeenCalledWith(
            expect.objectContaining({
                status: 'failed',
                error: 'provider failed',
            }),
        )
        expect(mocks.roomCronRepository.finishJob).toHaveBeenCalledWith(
            expect.objectContaining({
                status: 'failed',
                error: 'provider failed',
            }),
        )
    })

    it('reschedules missed due jobs from the actual completion time', async () => {
        const missed = cronJob({
            everyMinutes: 30,
            schedule: {
                type: 'interval',
                every: 30,
                unit: 'minutes',
            },
            nextRunAt: new Date('2026-04-29T22:00:00.000Z'),
        })
        mocks.roomCronRepository.claimDueJobs.mockResolvedValue([missed])
        mocks.getRoomConfigSnapshot.mockResolvedValue(readyConfig())
        mocks.roomRuntimeMetadataRepository.findByRoomId.mockResolvedValue({
            configVersion: 8,
        })
        mocks.roomCronRepository.createRun.mockResolvedValue(cronRun({ configVersion: 8 }))
        mocks.roomCronRepository.finishRun.mockResolvedValue(
            cronRun({
                status: 'complete',
                configVersion: 8,
                finishedAt: now,
                nextRunAt: new Date('2026-04-30T00:30:00.000Z'),
            }),
        )
        mocks.roomCronRepository.finishJob.mockResolvedValue(
            cronJob({
                lastRunStatus: 'complete',
                nextRunAt: new Date('2026-04-30T00:30:00.000Z'),
                configVersion: 8,
            }),
        )
        mocks.requestPiRuntime.mockImplementation(async (_roomId, path) => {
            if (path === '/threads') {
                return { key: 'thread-1' }
            }
            if (path === '/threads/thread-1/send') {
                return { status: 'idle' }
            }
            throw new Error(`Unexpected runtime path ${path}`)
        })

        const adapter = await import('./pi-execution-adapter')
        await expect(adapter.runDueRoomCronJobs()).resolves.toEqual([
            {
                jobId: missed.id,
                ran: true,
                reason: null,
            },
        ])

        expect(mocks.roomCronRepository.finishRun).toHaveBeenCalledWith(
            expect.objectContaining({
                nextRunAt: new Date('2026-04-30T00:30:00.000Z'),
            }),
        )
        expect(mocks.roomCronRepository.finishJob).toHaveBeenCalledWith(
            expect.objectContaining({
                nextRunAt: new Date('2026-04-30T00:30:00.000Z'),
            }),
        )
    })

    it('records runtime-unavailable failures and releases the job lock', async () => {
        const job = cronJob()
        mocks.roomCronRepository.claimDueJobs.mockResolvedValue([job])
        mocks.getRoomConfigSnapshot.mockResolvedValue(readyConfig())
        mocks.roomRuntimeMetadataRepository.findByRoomId.mockResolvedValue({
            configVersion: 8,
        })
        mocks.roomCronRepository.createRun.mockResolvedValue(
            cronRun({
                status: 'failed',
                sessionKey: null,
                error: 'Runtime unavailable',
                configVersion: 8,
            }),
        )
        mocks.roomCronRepository.finishJob.mockResolvedValue(
            cronJob({
                lastRunStatus: 'failed',
                lastError: 'Runtime unavailable',
                configVersion: 8,
            }),
        )
        mocks.requestPiRuntime.mockRejectedValue(new Error('Runtime unavailable'))

        const adapter = await import('./pi-execution-adapter')
        await expect(adapter.runDueRoomCronJobs()).resolves.toEqual([
            {
                jobId: job.id,
                ran: false,
                reason: 'Runtime unavailable',
            },
        ])

        expect(mocks.roomCronRepository.createRun).toHaveBeenCalledWith(
            expect.objectContaining({
                status: 'failed',
                error: 'Runtime unavailable',
                sessionKey: null,
            }),
        )
        expect(mocks.roomCronRepository.finishJob).toHaveBeenCalledWith(
            expect.objectContaining({
                lockToken: expect.any(String),
                status: 'failed',
                error: 'Runtime unavailable',
            }),
        )
    })

    it('does not run when the due-job claim returns no enabled or recoverable jobs', async () => {
        mocks.roomCronRepository.claimDueJobs.mockResolvedValue([])

        const adapter = await import('./pi-execution-adapter')
        await expect(adapter.runDueRoomCronJobs()).resolves.toEqual([])

        expect(mocks.getRoomConfigSnapshot).not.toHaveBeenCalled()
        expect(mocks.requestPiRuntime).not.toHaveBeenCalled()
        expect(mocks.roomCronRepository.createRun).not.toHaveBeenCalled()
    })

    it('distinguishes missing jobs from locked jobs on manual run-now', async () => {
        mocks.roomCronRepository.findJobById.mockResolvedValueOnce(null)

        const adapter = await import('./pi-execution-adapter')
        await expect(
            adapter.runRoomCronJobNow({
                roomId: '22222222-2222-4222-8222-222222222222',
                jobId: 'missing',
            }),
        ).rejects.toThrow('Cron job missing does not exist')

        mocks.roomCronRepository.findJobById.mockResolvedValueOnce(cronJob())
        mocks.roomCronRepository.claimJob.mockResolvedValueOnce(null)
        await expect(
            adapter.runRoomCronJobNow({
                roomId: '22222222-2222-4222-8222-222222222222',
                jobId: '11111111-1111-4111-8111-111111111111',
            }),
        ).resolves.toEqual({
            ran: false,
            reason: 'Job is already running',
        })
    })

    it('routes manual compaction, fork, and edit through explicit Pi thread endpoints', async () => {
        mocks.requestPiRuntime.mockImplementation(async (_roomId, path, _schema, options) => {
            if (path === '/threads/thread-1/compact') {
                return {
                    status: 'idle',
                    error: null,
                    compactionCount: 1,
                    options,
                }
            }
            if (path === '/threads/thread-1/fork') {
                return {
                    key: 'thread-fork',
                    parentThreadKey: 'thread-1',
                    parentSessionFile: '/sessions/parent.jsonl',
                    options,
                }
            }
            if (path === '/threads/thread-1/messages/message-1/edit') {
                return {
                    runId: 'run-edit',
                    status: 'accepted',
                    messageSeq: null,
                    interruptedActiveRun: false,
                    error: null,
                    options,
                }
            }
            throw new Error(`Unexpected runtime path ${path}`)
        })

        const adapter = await import('./pi-execution-adapter')
        await expect(
            adapter.compactRoomThread({
                roomId: '22222222-2222-4222-8222-222222222222',
                sessionKey: 'thread-1',
                instructions: 'Keep decisions only',
            }),
        ).resolves.toMatchObject({
            status: 'idle',
            compactionCount: 1,
        })
        await expect(
            adapter.forkRoomThread({
                roomId: '22222222-2222-4222-8222-222222222222',
                sessionKey: 'thread-1',
                title: 'Forked thread',
            }),
        ).resolves.toMatchObject({
            key: 'thread-fork',
            parentThreadKey: 'thread-1',
        })
        await expect(
            adapter.editRoomThreadMessage({
                roomId: '22222222-2222-4222-8222-222222222222',
                sessionKey: 'thread-1',
                messageId: 'message-1',
                message: 'Retry with bounded endpoint output',
            }),
        ).resolves.toMatchObject({
            runId: 'run-edit',
            status: 'accepted',
        })

        expect(mocks.requestPiRuntime).toHaveBeenCalledWith(
            '22222222-2222-4222-8222-222222222222',
            '/threads/thread-1/compact',
            expect.anything(),
            expect.objectContaining({
                method: 'POST',
                body: {
                    instructions: 'Keep decisions only',
                },
            }),
        )
        expect(mocks.requestPiRuntime).toHaveBeenCalledWith(
            '22222222-2222-4222-8222-222222222222',
            '/threads/thread-1/fork',
            expect.anything(),
            expect.objectContaining({
                method: 'POST',
                body: {
                    title: 'Forked thread',
                    entryId: null,
                },
            }),
        )
        expect(mocks.requestPiRuntime).toHaveBeenCalledWith(
            '22222222-2222-4222-8222-222222222222',
            '/threads/thread-1/messages/message-1/edit',
            expect.anything(),
            expect.objectContaining({
                method: 'POST',
                body: {
                    message: 'Retry with bounded endpoint output',
                    awaitCompletion: false,
                },
            }),
        )
    })

    it('routes wake messages through explicit Pi thread targets', async () => {
        mocks.requestPiRuntime.mockImplementation(async (_roomId, path, _schema, options) => {
            if (path === '/snapshot') {
                return {
                    selectedThreadKey: 'thread-1',
                    threads: [{ key: 'thread-1' }],
                }
            }
            if (path === '/threads/thread-1/send') {
                return {
                    status: 'accepted',
                    options,
                }
            }
            throw new Error(`Unexpected runtime path ${path}`)
        })

        const adapter = await import('./pi-execution-adapter')
        await adapter.wakeRoomRuntime({
            roomId: '22222222-2222-4222-8222-222222222222',
            text: ' Wake up ',
            mode: 'now',
        })

        expect(mocks.requestPiRuntime).toHaveBeenCalledWith(
            '22222222-2222-4222-8222-222222222222',
            '/threads/thread-1/send',
            expect.anything(),
            expect.objectContaining({
                method: 'POST',
                body: expect.objectContaining({
                    message: 'Wake up',
                    awaitCompletion: false,
                    runKind: 'manual',
                }),
            }),
        )
    })

    it('creates a new Pi thread for wake messages when the room has no target thread', async () => {
        mocks.requestPiRuntime.mockImplementation(async (_roomId, path, _schema, options) => {
            if (path === '/snapshot') {
                return {
                    selectedThreadKey: null,
                    threads: [],
                }
            }
            if (path === '/threads') {
                return {
                    key: 'thread-new',
                    options,
                }
            }
            throw new Error(`Unexpected runtime path ${path}`)
        })

        const adapter = await import('./pi-execution-adapter')
        await adapter.wakeRoomRuntime({
            roomId: '22222222-2222-4222-8222-222222222222',
            text: 'Wake up',
            mode: 'now',
        })

        expect(mocks.requestPiRuntime).toHaveBeenCalledWith(
            '22222222-2222-4222-8222-222222222222',
            '/threads',
            expect.anything(),
            expect.objectContaining({
                method: 'POST',
                body: expect.objectContaining({
                    firstMessage: 'Wake up',
                }),
            }),
        )
        expect(mocks.requestPiRuntime).not.toHaveBeenCalledWith(
            '22222222-2222-4222-8222-222222222222',
            '/threads/thread-new/send',
            expect.anything(),
            expect.anything(),
        )
    })

    it('fails closed for deferred wake mode until heartbeat scheduling is implemented', async () => {
        const adapter = await import('./pi-execution-adapter')
        await expect(
            adapter.wakeRoomRuntime({
                roomId: '22222222-2222-4222-8222-222222222222',
                text: 'Wake up',
                mode: 'next-heartbeat',
            }),
        ).rejects.toThrow('Deferred heartbeat wake is not implemented')
        expect(mocks.requestPiRuntime).not.toHaveBeenCalled()
    })
})
