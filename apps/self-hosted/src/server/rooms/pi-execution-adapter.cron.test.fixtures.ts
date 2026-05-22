import { vi } from 'vitest'
import type { RoomCronJobRecord, RoomCronRunRecord } from '#/domain/domain-types'

export const mocks = {
    roomCronRepository: {
        listJobsByRoomId: vi.fn(),
        findJobById: vi.fn(),
        createJob: vi.fn(),
        updateJob: vi.fn(),
        setJobEnabled: vi.fn(),
        removeJob: vi.fn(),
        claimJob: vi.fn(),
        claimDueJobs: vi.fn(),
        renewJobLease: vi.fn(),
        finishJob: vi.fn(),
        createRun: vi.fn(),
        finishRun: vi.fn(),
        listRunsByRoomId: vi.fn(),
    },
    roomRepository: {
        listWithRuntimeMetadata: vi.fn(),
        findById: vi.fn(),
    },
    roomRuntimeMetadataRepository: {
        findByRoomId: vi.fn(),
    },
    usageRepository: {
        appendEvent: vi.fn(),
    },
    getRoomConfigSnapshot: vi.fn(),
    requestPiRuntime: vi.fn(),
    openPiRuntimeEventStream: vi.fn(),
    openPiRuntimeRoomEventStream: vi.fn(),
    publishPiRuntimeRoomFileChanged: vi.fn(),
}

vi.mock('../db/repositories', () => ({
    roomCronRepository: mocks.roomCronRepository,
    roomRepository: mocks.roomRepository,
    roomRuntimeMetadataRepository: mocks.roomRuntimeMetadataRepository,
    usageRepository: mocks.usageRepository,
}))

vi.mock('../configuration/operator-configuration', () => ({
    getRoomConfigSnapshot: mocks.getRoomConfigSnapshot,
}))

vi.mock('./pi-runtime-client', () => ({
    requestPiRuntime: mocks.requestPiRuntime,
    openPiRuntimeEventStream: mocks.openPiRuntimeEventStream,
    openPiRuntimeRoomEventStream: mocks.openPiRuntimeRoomEventStream,
    publishPiRuntimeRoomFileChanged: mocks.publishPiRuntimeRoomFileChanged,
}))

export const now = new Date('2026-04-30T00:00:00.000Z')

export function cronJob(overrides: Partial<RoomCronJobRecord> = {}): RoomCronJobRecord {
    return {
        id: '11111111-1111-4111-8111-111111111111',
        roomId: '22222222-2222-4222-8222-222222222222',
        name: 'Digest',
        message: 'Summarize today',
        enabled: true,
        everyMinutes: 15,
        schedule: {
            type: 'interval',
            every: 15,
            unit: 'minutes',
        },
        timezone: 'UTC',
        sessionTarget: 'isolated',
        targetThreadKey: null,
        nextRunAt: now,
        runningAt: null,
        heartbeatAt: null,
        lockedUntil: null,
        lockToken: null,
        lastRenewedAt: null,
        runBudgetMs: null,
        recoveryReason: null,
        lastRunAt: null,
        lastRunStatus: null,
        lastError: null,
        lastDurationMs: null,
        provider: 'openrouter',
        model: 'openrouter/google/gemini-2.5-pro',
        configVersion: 3,
        createdAt: now,
        updatedAt: now,
        ...overrides,
    }
}

export function cronRun(overrides: Partial<RoomCronRunRecord> = {}): RoomCronRunRecord {
    return {
        id: '33333333-3333-4333-8333-333333333333',
        roomId: '22222222-2222-4222-8222-222222222222',
        jobId: '11111111-1111-4111-8111-111111111111',
        jobName: 'Digest',
        attempt: 1,
        status: 'running',
        summary: 'Summarize today',
        error: null,
        sessionKey: 'thread-1',
        sessionId: null,
        provider: 'openrouter',
        model: 'openrouter/google/gemini-2.5-pro',
        configVersion: 4,
        startedAt: now,
        finishedAt: null,
        durationMs: null,
        nextRunAt: null,
        ...overrides,
    }
}

export function readyConfig() {
    return {
        config: {
            cronTimezone: 'UTC',
        },
        effective: {
            ready: true,
            blockedReasons: [],
            provider: 'openrouter',
            model: 'openrouter/google/gemini-2.5-pro',
        },
    }
}

export function blockedConfig() {
    return {
        config: {
            cronTimezone: 'UTC',
        },
        effective: {
            ready: false,
            blockedReasons: ['Provider validation failed'],
            provider: 'openrouter',
            model: 'openrouter/google/gemini-2.5-pro',
        },
    }
}
