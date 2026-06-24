import type { D1Database, Queue, R2Bucket } from '@cloudflare/workers-types'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentRoomHostedEnv, AgentRoomRuntimeJobMessage } from './bindings'
import { runDueHostedRoomCronJobs } from './hosted-cron-adapter'
import { finishHostedCronRunFromRuntimeEvent } from './hosted-cron-management'
import type * as HostedRoomService from './hosted-room-service'

const mocks = vi.hoisted(() => ({
    getHostedRoomConfigSnapshot: vi.fn(),
    requestHostedPiRuntime: vi.fn(),
}))

vi.mock('./hosted-room-service', async (importOriginal) => {
    const actual = await importOriginal<typeof HostedRoomService>()
    return {
        ...actual,
        getHostedRoomConfigSnapshot: mocks.getHostedRoomConfigSnapshot,
    }
})

vi.mock('./hosted-runtime-client', () => ({
    requestHostedPiRuntime: mocks.requestHostedPiRuntime,
}))

describe('hosted cron runtime boundary', () => {
    beforeEach(() => {
        mocks.getHostedRoomConfigSnapshot.mockReset()
        mocks.requestHostedPiRuntime.mockReset()
    })

    it('queues runtime reconcile instead of claiming due jobs when the runtime is not healthy', async () => {
        const sent: AgentRoomRuntimeJobMessage[] = []
        let claimed = false
        const now = new Date(0).toISOString()
        const db = {
            prepare: (sql: string) => ({
                bind: () => ({
                    all: async () => {
                        if (/FROM hosted_room_job job/.test(sql)) {
                            return {
                                results: [
                                    {
                                        id: 'job_1',
                                        workspaceId: 'workspace_1',
                                        roomId: 'room_1',
                                        createdByUserId: 'user_1',
                                        name: 'Daily check',
                                        message: 'check status',
                                        enabled: 1,
                                        schedule: JSON.stringify({
                                            type: 'interval',
                                            every: 1,
                                            unit: 'hours',
                                        }),
                                        timezone: 'UTC',
                                        nextRunAt: now,
                                        runningAt: null,
                                        lockedUntil: null,
                                        lockToken: null,
                                        lastRunAt: null,
                                        lastRunStatus: null,
                                        lastError: null,
                                        lastDurationMs: null,
                                        provider: null,
                                        model: null,
                                        configVersion: 1,
                                    },
                                ],
                            }
                        }
                        return { results: [] }
                    },
                    first: async () => {
                        if (
                            /FROM hosted_room AS room\s+INNER JOIN hosted_room_runtime_state/.test(
                                sql,
                            )
                        ) {
                            return {
                                desiredState: 'running',
                                status: 'running',
                                roomId: 'room_1',
                                workspaceId: 'workspace_1',
                                containerName: 'workspace:workspace_1:room:room_1',
                                configObjectKey: 'config-key',
                                tokenObjectKey: null,
                                runtimeBundleObjectKey: 'bundle-key',
                                providerCandidate: null,
                                managedBraveSearchEnabled: false,
                                workspaceSnapshotKey: null,
                                configVersion: 1,
                                tokenVersion: 1,
                                healthStatus: 'unknown',
                                startedAt: null,
                                lastHealthAt: null,
                                lastError: null,
                                updatedAt: now,
                            }
                        }
                        return null
                    },
                    run: async () => {
                        if (/UPDATE hosted_room_job\s+SET running_at/.test(sql)) {
                            claimed = true
                        }
                        return {
                            meta: {
                                changes: 1,
                            },
                        }
                    },
                }),
            }),
        } as unknown as D1Database
        const env = {
            AGENT_ROOM_DB: db,
            AGENT_ROOM_WORKSPACE_BUCKET: {} as R2Bucket,
            AGENT_ROOM_RUNTIME_JOBS: {
                send: async (message: AgentRoomRuntimeJobMessage) => {
                    sent.push(message)
                },
            } as unknown as Queue<AgentRoomRuntimeJobMessage>,
            AGENT_ROOM_RUNTIME: {} as AgentRoomHostedEnv['AGENT_ROOM_RUNTIME'],
        } as AgentRoomHostedEnv

        await expect(runDueHostedRoomCronJobs(env)).resolves.toEqual([
            {
                jobId: 'job_1',
                ran: false,
                reason: 'Room runtime reconcile queued',
            },
        ])
        expect(claimed).toBe(false)
        expect(sent).toEqual([
            {
                kind: 'room-runtime-reconcile',
                workspaceId: 'workspace_1',
                roomId: 'room_1',
                actorUserId: 'user_1',
                requestedAt: expect.any(String),
            },
        ])
    })

    it('does not claim a due job that is disabled before the lease update', async () => {
        const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {})
        let claimAttempted = false
        const now = new Date(0).toISOString()
        const job = {
            id: 'job_1',
            workspaceId: 'workspace_1',
            roomId: 'room_1',
            createdByUserId: 'user_1',
            name: 'Daily check',
            message: 'check status',
            enabled: 0,
            schedule: JSON.stringify({
                type: 'interval',
                every: 1,
                unit: 'hours',
            }),
            timezone: 'UTC',
            nextRunAt: null,
            runningAt: null,
            lockedUntil: null,
            lockToken: null,
            lastRunAt: null,
            lastRunStatus: null,
            lastError: null,
            lastDurationMs: null,
            provider: null,
            model: null,
            configVersion: 1,
        }
        const db = {
            prepare: (sql: string) => ({
                bind: () => ({
                    all: async () => {
                        if (/FROM hosted_room_job job/.test(sql)) {
                            return {
                                results: [
                                    {
                                        ...job,
                                        enabled: 1,
                                        nextRunAt: now,
                                    },
                                ],
                            }
                        }
                        return { results: [] }
                    },
                    first: async () => {
                        if (
                            /FROM hosted_room AS room\s+INNER JOIN hosted_room_runtime_state/.test(
                                sql,
                            )
                        ) {
                            return {
                                desiredState: 'running',
                                status: 'running',
                                roomId: 'room_1',
                                workspaceId: 'workspace_1',
                                containerName: 'workspace:workspace_1:room:room_1',
                                configObjectKey: 'config-key',
                                tokenObjectKey: 'token-key',
                                runtimeBundleObjectKey: 'bundle-key',
                                providerCandidate: 'user_key',
                                workspaceSnapshotKey: null,
                                configVersion: 1,
                                tokenVersion: 1,
                                healthStatus: 'healthy',
                                startedAt: now,
                                lastHealthAt: now,
                                lastError: null,
                                updatedAt: now,
                            }
                        }
                        if (/FROM hosted_room_job/.test(sql)) {
                            return job
                        }
                        return null
                    },
                    run: async () => {
                        if (/UPDATE hosted_room_job\s+SET running_at/.test(sql)) {
                            claimAttempted = true
                            expect(sql).toContain('enabled = 1')
                            expect(sql).toContain('next_run_at <= ?8')
                            expect(sql).toContain("hosted_room.desired_state = 'running'")
                            return {
                                meta: {
                                    changes: 0,
                                },
                            }
                        }
                        return {
                            meta: {
                                changes: 1,
                            },
                        }
                    },
                }),
            }),
        } as unknown as D1Database
        const env = {
            AGENT_ROOM_DB: db,
            AGENT_ROOM_WORKSPACE_BUCKET: {} as R2Bucket,
            AGENT_ROOM_RUNTIME_JOBS: {
                send: async () => {},
            } as unknown as Queue<AgentRoomRuntimeJobMessage>,
            AGENT_ROOM_RUNTIME: {
                getByName: () => ({
                    getState: async () => ({
                        status: 'healthy',
                        lastChange: 0,
                    }),
                }),
            } as unknown as AgentRoomHostedEnv['AGENT_ROOM_RUNTIME'],
        } as AgentRoomHostedEnv

        try {
            await expect(runDueHostedRoomCronJobs(env)).resolves.toEqual([])
            expect(claimAttempted).toBe(true)
        } finally {
            consoleWarn.mockRestore()
        }
    })

    it('closes stale runs and sends scheduled runtime usage context for recovered leases', async () => {
        const now = new Date(0).toISOString()
        const expiredAt = new Date(Date.now() - 60000).toISOString()
        const requests: Array<{ path: string; body: unknown }> = []
        const staleRunUpdates: unknown[][] = []
        const snapshotUpdates: unknown[][] = []
        const insertedRuns: unknown[][] = []
        const job = {
            id: 'job_1',
            workspaceId: 'workspace_1',
            roomId: 'room_1',
            createdByUserId: 'user_1',
            name: 'Daily check',
            message: 'check status',
            enabled: 1,
            schedule: JSON.stringify({
                type: 'interval',
                every: 1,
                unit: 'hours',
            }),
            timezone: 'UTC',
            nextRunAt: now,
            runningAt: new Date(Date.now() - 120000).toISOString(),
            lockedUntil: expiredAt,
            lockToken: 'old-lock',
            lastRunAt: null,
            lastRunStatus: 'running',
            lastError: null,
            lastDurationMs: null,
            provider: 'old-provider',
            model: 'old-model',
            configVersion: 3,
        }
        mocks.getHostedRoomConfigSnapshot.mockResolvedValue({
            effective: {
                provider: 'openrouter',
                model: 'openrouter/auto',
            },
        })
        mocks.requestHostedPiRuntime.mockImplementation(
            async (input: { path: string; body?: unknown }) => {
                requests.push({
                    path: input.path,
                    body: input.body,
                })
                if (input.path === '/threads') {
                    return { key: 'thread-1' }
                }
                if (input.path === '/threads/thread-1/send') {
                    return {
                        runId:
                            input.body && typeof input.body === 'object' && 'runId' in input.body
                                ? input.body.runId
                                : null,
                        status: 'accepted',
                        messageSeq: null,
                        interruptedActiveRun: false,
                        error: null,
                    }
                }
                throw new Error(`Unexpected runtime request ${input.path}`)
            },
        )
        const runtimeRow = {
            desiredState: 'running',
            status: 'running',
            roomId: 'room_1',
            workspaceId: 'workspace_1',
            containerName: 'workspace:workspace_1:room:room_1',
            configObjectKey: 'config-key',
            tokenObjectKey: 'token-key',
            runtimeBundleObjectKey: 'bundle-key',
            providerCandidate: 'user_key',
            workspaceSnapshotKey: null,
            configVersion: 17,
            tokenVersion: 2,
            healthStatus: 'healthy',
            startedAt: now,
            lastHealthAt: now,
            lastError: null,
            updatedAt: now,
        }
        const db = {
            prepare: (sql: string) => ({
                bind: (...args: unknown[]) => ({
                    all: async () => {
                        if (/FROM hosted_room_job job/.test(sql)) {
                            return {
                                results: [job],
                            }
                        }
                        return { results: [] }
                    },
                    first: async () => {
                        if (
                            /FROM hosted_room AS room\s+INNER JOIN hosted_room_runtime_state/.test(
                                sql,
                            )
                        ) {
                            return runtimeRow
                        }
                        if (/FROM hosted_room_runtime_state/.test(sql)) {
                            return runtimeRow
                        }
                        if (/FROM hosted_room_job/.test(sql)) {
                            return job
                        }
                        return null
                    },
                    run: async () => {
                        if (/UPDATE hosted_room_job_run\s+SET status = 'failed'/.test(sql)) {
                            staleRunUpdates.push(args)
                        }
                        if (/UPDATE hosted_room_job\s+SET provider = \?1/.test(sql)) {
                            snapshotUpdates.push(args)
                        }
                        if (/INSERT INTO hosted_room_job_run/.test(sql)) {
                            insertedRuns.push(args)
                        }
                        return {
                            meta: {
                                changes: 1,
                            },
                        }
                    },
                }),
            }),
        } as unknown as D1Database
        const env = {
            AGENT_ROOM_DB: db,
            AGENT_ROOM_WORKSPACE_BUCKET: {} as R2Bucket,
            AGENT_ROOM_RUNTIME_JOBS: {
                send: async () => {},
            } as unknown as Queue<AgentRoomRuntimeJobMessage>,
            AGENT_ROOM_RUNTIME: {
                getByName: () => ({
                    getState: async () => ({
                        status: 'healthy',
                        lastChange: 0,
                    }),
                }),
            } as unknown as AgentRoomHostedEnv['AGENT_ROOM_RUNTIME'],
        } as AgentRoomHostedEnv

        await expect(runDueHostedRoomCronJobs(env)).resolves.toEqual([
            {
                jobId: 'job_1',
                ran: true,
                reason: null,
            },
        ])

        expect(staleRunUpdates).toHaveLength(1)
        expect(staleRunUpdates[0]).toEqual([expect.any(String), 'workspace_1', 'room_1', 'job_1'])
        expect(snapshotUpdates[0]).toEqual([
            'openrouter',
            'openrouter/auto',
            17,
            expect.any(String),
            'workspace_1',
            'room_1',
            'job_1',
            expect.any(String),
        ])
        expect(insertedRuns[0]?.[10]).toBe('openrouter')
        expect(insertedRuns[0]?.[11]).toBe('openrouter/auto')
        expect(insertedRuns[0]?.[12]).toBe(17)
        expect(requests.find((request) => request.path === '/threads/thread-1/send')?.body).toEqual(
            expect.objectContaining({
                runKind: 'scheduled',
                jobId: 'job_1',
            }),
        )
    })

    it('requires the canonical runtime job id before finishing cron rows from callbacks', async () => {
        const db = {
            prepare: () => {
                throw new Error('Callback without a job id must not query cron rows')
            },
        } as unknown as D1Database
        const env = {
            AGENT_ROOM_DB: db,
        } as AgentRoomHostedEnv

        await expect(
            finishHostedCronRunFromRuntimeEvent({
                env,
                workspaceId: 'workspace_1',
                roomId: 'room_1',
                runId: 'run_1',
                jobId: null,
                status: 'idle',
                error: null,
            }),
        ).resolves.toBeUndefined()
    })

    it('finishes callback rows with matching room, run, and job identity', async () => {
        const runUpdates: unknown[][] = []
        const jobUpdates: unknown[][] = []
        const selects: unknown[][] = []
        const now = new Date(0).toISOString()
        const job = {
            id: 'job_1',
            name: 'Daily check',
            message: 'check status',
            enabled: 1,
            schedule: JSON.stringify({
                type: 'interval',
                every: 1,
                unit: 'hours',
            }),
            timezone: 'UTC',
            nextRunAt: now,
            runningAt: now,
            lockedUntil: now,
            lockToken: 'lock_1',
            lastRunAt: now,
            lastRunStatus: 'running',
            lastError: null,
            lastDurationMs: null,
            provider: 'old-provider',
            model: 'old-model',
            configVersion: 1,
        }
        const db = {
            prepare: (sql: string) => ({
                bind: (...args: unknown[]) => ({
                    first: async () => {
                        if (/FROM hosted_room_job_run/.test(sql)) {
                            selects.push(args)
                            return {
                                id: 'run_1',
                                jobId: 'job_1',
                                lockToken: 'lock_1',
                                startedAt: now,
                            }
                        }
                        if (/FROM hosted_room_job/.test(sql)) {
                            return job
                        }
                        return null
                    },
                    run: async () => {
                        if (/UPDATE hosted_room_job_run/.test(sql)) {
                            expect(sql).toContain('room_id = ?10')
                            runUpdates.push(args)
                        }
                        if (/UPDATE hosted_room_job\s+SET running_at = NULL/.test(sql)) {
                            jobUpdates.push(args)
                        }
                        return {
                            meta: {
                                changes: 1,
                            },
                        }
                    },
                }),
            }),
        } as unknown as D1Database
        const env = {
            AGENT_ROOM_DB: db,
        } as AgentRoomHostedEnv

        await finishHostedCronRunFromRuntimeEvent({
            env,
            workspaceId: 'workspace_1',
            roomId: 'room_1',
            runId: 'run_1',
            jobId: 'job_1',
            status: 'idle',
            error: null,
            provider: 'openrouter',
            model: 'openrouter/auto',
            configVersion: 17,
        })

        expect(selects).toEqual([['workspace_1', 'room_1', 'run_1', 'job_1']])
        expect(runUpdates[0]).toEqual([
            'complete',
            null,
            expect.any(String),
            expect.any(Number),
            expect.any(String),
            'openrouter',
            'openrouter/auto',
            17,
            'workspace_1',
            'room_1',
            'run_1',
        ])
        expect(jobUpdates[0]).toEqual([
            expect.any(String),
            'complete',
            null,
            expect.any(Number),
            'openrouter',
            'openrouter/auto',
            17,
            expect.any(String),
            'workspace_1',
            'room_1',
            'job_1',
            'lock_1',
        ])
    })
})
