import type { AgentRoomHostedEnv } from './bindings'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { editRoomThreadMessage, sendRoomThreadMessage } from './hosted-execution-adapter'

const mocks = vi.hoisted(() => ({
    assertHostedRunAllowed: vi.fn(),
    requireHostedExecutionContext: vi.fn(),
    requestHostedPiRuntime: vi.fn(),
    openHostedPiRuntimeStream: vi.fn(),
}))

vi.mock('./hosted-execution-context', () => ({
    assertHostedRunAllowed: mocks.assertHostedRunAllowed,
    requireHostedExecutionContext: mocks.requireHostedExecutionContext,
}))

vi.mock('./hosted-runtime-client', () => ({
    requestHostedPiRuntime: mocks.requestHostedPiRuntime,
    openHostedPiRuntimeStream: mocks.openHostedPiRuntimeStream,
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
})
