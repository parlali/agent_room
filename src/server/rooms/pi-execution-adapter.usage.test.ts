import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
    roomCronRepository: {},
    roomRepository: {
        listRooms: vi.fn(),
    },
    roomRuntimeMetadataRepository: {},
    usageRepository: {
        appendEvent: vi.fn(),
        attachJobToRun: vi.fn(),
    },
    getRoomConfigSnapshot: vi.fn(),
    requestPiRuntime: vi.fn(),
    openPiRuntimeEventStream: vi.fn(),
    openPiRuntimeRoomEventStream: vi.fn(),
    publishPiRuntimeRoomFileChanged: vi.fn(),
}))

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

describe('Pi runtime usage sync', () => {
    let root: string
    let previousDataDir: string | undefined

    beforeEach(async () => {
        vi.resetModules()
        root = await mkdtemp(join(tmpdir(), 'agent-room-usage-sync-'))
        previousDataDir = process.env.AGENT_ROOM_DATA_DIR
        process.env.AGENT_ROOM_DATA_DIR = root
        mocks.usageRepository.appendEvent.mockReset()
        mocks.usageRepository.attachJobToRun.mockReset()
        mocks.roomRepository.listRooms.mockReset()
        mocks.requestPiRuntime.mockReset()
    })

    afterEach(async () => {
        if (previousDataDir === undefined) {
            delete process.env.AGENT_ROOM_DATA_DIR
        } else {
            process.env.AGENT_ROOM_DATA_DIR = previousDataDir
        }
        await rm(root, {
            recursive: true,
            force: true,
        })
    })

    it('records completed runs and later tool events once, using the runtime event cursor', async () => {
        const roomId = 'usage-room'
        const { getRoomPaths } = await import('./room-paths')
        const paths = getRoomPaths(roomId)
        await mkdir(paths.engineStateDir, {
            recursive: true,
        })
        await writeFile(
            join(paths.engineStateDir, 'runtime-events.jsonl'),
            [
                JSON.stringify({
                    ts: 1000,
                    event: 'run.finished',
                    sessionKey: 'thread-1',
                    runId: 'run-1',
                    payload: {
                        runKind: 'manual',
                        status: 'idle',
                        provider: 'openrouter',
                        model: 'model-a',
                        durationMs: 1200,
                        activeDurationMs: 900,
                        idleDurationMs: 300,
                        usage: {
                            inputTokens: 100,
                            outputTokens: 50,
                            cachedTokens: 25,
                            reasoningTokens: null,
                            totalTokens: 175,
                            estimatedCostUsd: 0.01,
                        },
                    },
                }),
                JSON.stringify({
                    ts: 1100,
                    event: 'tool.image_generate',
                    sessionKey: 'thread-1',
                    runId: 'run-1',
                    payload: {
                        provider: 'gemini',
                        model: 'gemini-image',
                        latencyMs: 2500,
                    },
                }),
                '',
            ].join('\n'),
            'utf8',
        )
        mocks.usageRepository.appendEvent.mockImplementation(
            () => new Promise((resolve) => setTimeout(resolve, 10)),
        )

        const adapter = await import('./pi-execution-adapter')
        await Promise.all([
            adapter.syncRuntimeUsageEvents(roomId),
            adapter.syncRuntimeUsageEvents(roomId),
        ])
        await adapter.syncRuntimeUsageEvents(roomId)

        expect(mocks.usageRepository.appendEvent).toHaveBeenCalledTimes(2)
        expect(mocks.usageRepository.appendEvent).toHaveBeenNthCalledWith(
            1,
            expect.objectContaining({
                roomId,
                sessionKey: 'thread-1',
                runId: 'run-1',
                kind: 'run',
                provider: 'openrouter',
                model: 'model-a',
                inputTokens: 100,
                outputTokens: 50,
                cachedTokens: 25,
                reasoningTokens: null,
                totalTokens: 175,
                durationMs: 1200,
                activeDurationMs: 900,
                idleDurationMs: 300,
                estimatedCostUsd: 0.01,
            }),
        )
        expect(mocks.usageRepository.appendEvent).toHaveBeenNthCalledWith(
            2,
            expect.objectContaining({
                roomId,
                sessionKey: 'thread-1',
                runId: 'run-1',
                kind: 'image',
                provider: 'gemini',
                model: 'gemini-image',
                toolName: 'agent_room_image_generate',
                durationMs: 2500,
            }),
        )
    })

    it('links scheduled runtime usage records back to the cron job id', async () => {
        mocks.requestPiRuntime.mockResolvedValue({
            runId: 'scheduled-run-1',
            status: 'idle',
            messageSeq: null,
            interruptedActiveRun: false,
            error: null,
        })

        const adapter = await import('./pi-execution-adapter')
        await adapter.sendRoomThreadMessage({
            roomId: 'usage-room',
            sessionKey: 'thread-1',
            message: 'Run the scheduled report',
            awaitCompletion: true,
            runKind: 'scheduled',
            jobId: '11111111-1111-1111-1111-111111111111',
        })

        expect(mocks.usageRepository.attachJobToRun).toHaveBeenCalledWith({
            roomId: 'usage-room',
            runId: 'scheduled-run-1',
            jobId: '11111111-1111-1111-1111-111111111111',
        })
    })

    it('records provider usage events for background model calls', async () => {
        const roomId = 'usage-room'
        const { getRoomPaths } = await import('./room-paths')
        const paths = getRoomPaths(roomId)
        await mkdir(paths.engineStateDir, {
            recursive: true,
        })
        await writeFile(
            join(paths.engineStateDir, 'runtime-events.jsonl'),
            [
                JSON.stringify({
                    ts: 1000,
                    event: 'provider.finished',
                    sessionKey: 'thread-1',
                    payload: {
                        purpose: 'thread_title',
                        provider: 'openai-codex',
                        model: 'gpt-5.5',
                        durationMs: 900,
                        usage: {
                            inputTokens: 120,
                            outputTokens: 12,
                            cachedTokens: 30,
                            reasoningTokens: null,
                            totalTokens: 162,
                            estimatedCostUsd: 0.001,
                            costKnown: true,
                        },
                    },
                }),
                '',
            ].join('\n'),
            'utf8',
        )

        const adapter = await import('./pi-execution-adapter')
        await adapter.syncRuntimeUsageEvents(roomId)

        expect(mocks.usageRepository.appendEvent).toHaveBeenCalledWith(
            expect.objectContaining({
                roomId,
                sessionKey: 'thread-1',
                kind: 'provider',
                provider: 'openai-codex',
                model: 'gpt-5.5',
                inputTokens: 120,
                outputTokens: 12,
                cachedTokens: 30,
                totalTokens: 162,
                durationMs: 900,
                estimatedCostUsd: 0.001,
            }),
        )
    })
})
