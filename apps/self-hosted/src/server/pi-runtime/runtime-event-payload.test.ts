import { describe, expect, it } from 'vitest'
import { runtimeBroadcastPayload, runtimeEventLogPayload } from './runtime-event-payload'

describe('runtime event payload shaping', () => {
    it('keeps live text deltas without broadcasting full partial text', () => {
        const largeText = 'x'.repeat(20_000)
        const payload = runtimeBroadcastPayload('message_update', {
            sessionKey: 'thread-1',
            event: {
                type: 'message_update',
                assistantMessageEvent: {
                    type: 'text_delta',
                    contentIndex: 1,
                    delta: 'ok',
                    partial: {
                        role: 'assistant',
                        content: [
                            {
                                type: 'thinking',
                                thinking: largeText,
                            },
                            {
                                type: 'text',
                                text: largeText,
                                textSignature: '{"phase":"final_answer"}',
                            },
                        ],
                    },
                },
            },
        })

        expect(JSON.stringify(payload)).not.toContain(largeText)
        expect(payload).toMatchObject({
            event: {
                type: 'message_update',
                assistantMessageEvent: {
                    type: 'text_delta',
                    contentIndex: 1,
                    delta: 'ok',
                    partial: {
                        role: 'assistant',
                        content: [
                            null,
                            {
                                type: 'text',
                                textSignature: '{"phase":"final_answer"}',
                            },
                        ],
                    },
                },
            },
        })
    })

    it('removes raw image and thinking bodies from live terminal message events', () => {
        const largeText = 'x'.repeat(20_000)
        const payload = runtimeBroadcastPayload('message_end', {
            sessionKey: 'thread-1',
            event: {
                type: 'message_end',
                message: {
                    role: 'assistant',
                    content: [
                        {
                            type: 'image',
                            data: largeText,
                        },
                        {
                            type: 'thinking',
                            thinking: largeText,
                        },
                        {
                            type: 'text',
                            text: 'Done',
                            textSignature: '{"phase":"final_answer"}',
                        },
                    ],
                },
            },
        })

        expect(JSON.stringify(payload)).not.toContain(largeText)
        expect(payload).toMatchObject({
            event: {
                type: 'message_end',
                message: {
                    role: 'assistant',
                    content: [
                        {
                            type: 'image',
                        },
                        {
                            type: 'thinking',
                            redacted: true,
                        },
                        {
                            type: 'text',
                            text: 'Done',
                        },
                    ],
                },
            },
        })
    })

    it('logs message updates as metadata instead of raw streamed text', () => {
        const payload = runtimeEventLogPayload('message_update', {
            event: {
                type: 'message_update',
                assistantMessageEvent: {
                    type: 'text_delta',
                    contentIndex: 0,
                    delta: 'hello',
                },
            },
        })

        expect(payload).toEqual({
            event: {
                type: 'message_update',
                assistantMessageEvent: {
                    type: 'text_delta',
                    contentIndex: 0,
                    textLength: 5,
                },
            },
        })
    })
})
