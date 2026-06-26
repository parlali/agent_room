import type { AgentRoomHostedEnv } from './bindings'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
    editRoomThreadMessage,
    sendRoomThreadMessage,
    updateRoomThreadModel,
} from './hosted-execution-adapter'

const mocks = vi.hoisted(() => ({
    assertHostedRunAllowed: vi.fn(),
    requireHostedExecutionContext: vi.fn(),
    requestHostedPiRuntime: vi.fn(),
    openHostedPiRuntimeStream: vi.fn(),
    getHostedRuntimeState: vi.fn(),
    getHostedRoomMode: vi.fn(),
    listHostedRooms: vi.fn(),
}))

vi.mock('./hosted-execution-context', () => ({
    assertHostedRunAllowed: mocks.assertHostedRunAllowed,
    requireHostedExecutionContext: mocks.requireHostedExecutionContext,
}))

vi.mock('./hosted-runtime-client', () => ({
    requestHostedPiRuntime: mocks.requestHostedPiRuntime,
    openHostedPiRuntimeStream: mocks.openHostedPiRuntimeStream,
}))

vi.mock('./hosted-room-service', () => ({
    getHostedRuntimeState: mocks.getHostedRuntimeState,
    getHostedRoomMode: mocks.getHostedRoomMode,
    listHostedRooms: mocks.listHostedRooms,
}))

function hostedEnv(): AgentRoomHostedEnv {
    return {} as AgentRoomHostedEnv
}

describe('hosted execution adapter', () => {
    beforeEach(() => {
        mocks.assertHostedRunAllowed.mockReset()
        mocks.requireHostedExecutionContext.mockReset()
        mocks.requestHostedPiRuntime.mockReset()
        mocks.openHostedPiRuntimeStream.mockReset()
        mocks.getHostedRuntimeState.mockReset()
        mocks.getHostedRoomMode.mockReset()
        mocks.listHostedRooms.mockReset()
        mocks.requireHostedExecutionContext.mockResolvedValue({
            context: {
                env: hostedEnv(),
                request: new Request('https://agent-room.example/rooms/room_1'),
            },
            actor: {
                userId: 'user_1',
                workspaceId: 'workspace_1',
            },
        })
    })

    it('validates manual send messages before consuming run quota', async () => {
        await expect(
            sendRoomThreadMessage({
                roomId: 'room_1',
                sessionKey: 'session_1',
                message: '   ',
            }),
        ).rejects.toThrow('Message cannot be empty')

        expect(mocks.assertHostedRunAllowed).not.toHaveBeenCalled()
        expect(mocks.requestHostedPiRuntime).not.toHaveBeenCalled()
    })

    it('validates edited messages before consuming run quota', async () => {
        await expect(
            editRoomThreadMessage({
                roomId: 'room_1',
                sessionKey: 'session_1',
                messageId: 'message_1',
                message: '',
            }),
        ).rejects.toThrow('Message cannot be empty')

        expect(mocks.assertHostedRunAllowed).not.toHaveBeenCalled()
        expect(mocks.requestHostedPiRuntime).not.toHaveBeenCalled()
    })

    it('fails closed when updating a hosted thread model without runtime state', async () => {
        mocks.getHostedRuntimeState.mockResolvedValue(null)

        await expect(
            updateRoomThreadModel({
                roomId: 'room_1',
                sessionKey: 'session_1',
                provider: 'openrouter',
                model: 'openrouter/auto',
            }),
        ).rejects.toThrow('Hosted runtime state was not found')

        expect(mocks.requestHostedPiRuntime).not.toHaveBeenCalled()
    })
})
