import { describe, expect, it, vi } from 'vitest'
import { createRoomEventStream, createRoomSessionEventStream } from './hosted-execution-adapter'

const mocks = vi.hoisted(() => {
    const stoppedEndpoint = {
        desiredState: 'stopped',
        status: 'stopped',
        runtime: {
            roomId: 'room_1',
            workspaceId: 'workspace_1',
            containerName: 'agent-room-runtime',
            configObjectKey: null,
            tokenObjectKey: null,
            runtimeBundleObjectKey: null,
            providerCandidate: null,
            workspaceSnapshotKey: null,
            configVersion: 0,
            tokenVersion: 0,
            healthStatus: 'unknown',
            startedAt: null,
            lastHealthAt: null,
            lastError: 'Runtime stopped',
            updatedAt: '1970-01-01T00:00:00.000Z',
        },
    }
    return {
        getHostedRuntimeEndpointState: vi.fn(async () => stoppedEndpoint),
        openHostedPiRuntimeStream: vi.fn(async () => {
            throw new Error('must not attach to a stopped room')
        }),
    }
})

vi.mock('./hosted-room-service', () => ({
    getHostedRuntimeEndpointState: mocks.getHostedRuntimeEndpointState,
    getHostedRoomMode: vi.fn(),
    getHostedRuntimeState: vi.fn(),
    listHostedRooms: vi.fn(),
    failClosedHostedRuntime: vi.fn(),
    HostedRuntimeMaterializationConflictError: class HostedRuntimeMaterializationConflictError {},
    materializeHostedRuntime: vi.fn(),
    stopHostedRuntime: vi.fn(),
}))

vi.mock('./hosted-runtime-client', () => ({
    openHostedPiRuntimeStream: mocks.openHostedPiRuntimeStream,
    requestHostedPiRuntime: vi.fn(),
    readHostedRuntimeToken: vi.fn(),
}))

async function firstFrame(stream: ReadableStream<Uint8Array>): Promise<string> {
    const reader = stream.getReader()
    const result = await reader.read()
    await reader.cancel()
    return new TextDecoder().decode(result.value ?? new Uint8Array())
}

describe('hosted event streams hold open for stopped rooms', () => {
    it('emits a held heartbeat for a stopped room instead of throwing', async () => {
        const stream = createRoomEventStream({
            roomId: 'room_1',
            context: { env: {} as never, workspaceId: 'workspace_1' },
        })
        const frame = await firstFrame(stream)
        expect(frame.startsWith(': heartbeat')).toBe(true)
        expect(mocks.openHostedPiRuntimeStream).not.toHaveBeenCalled()
    })

    it('holds the session stream for a stopped room without attaching', async () => {
        const stream = createRoomSessionEventStream({
            roomId: 'room_1',
            sessionKey: 'session_1',
            context: { env: {} as never, workspaceId: 'workspace_1' },
        })
        const frame = await firstFrame(stream)
        expect(frame.startsWith(': heartbeat')).toBe(true)
        expect(mocks.openHostedPiRuntimeStream).not.toHaveBeenCalled()
    })
})
