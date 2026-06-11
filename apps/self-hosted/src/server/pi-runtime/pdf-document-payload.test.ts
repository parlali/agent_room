import { describe, expect, it } from 'vitest'
import { rewriteNativePdfPayload } from './pdf-document-payload'

describe('native PDF payload rewriting', () => {
    it('rewrites PDF image placeholders into native document blocks without logging data', () => {
        const payload = {
            messages: [
                {
                    role: 'user',
                    content: [
                        {
                            type: 'image',
                            source: {
                                type: 'base64',
                                media_type: 'application/pdf',
                                data: 'pdf-base64',
                            },
                            cache_control: {
                                type: 'ephemeral',
                            },
                        },
                        {
                            type: 'text',
                            text: 'Read it',
                        },
                    ],
                },
            ],
        }

        const rewritten = rewriteNativePdfPayload(payload)

        expect(rewritten.count).toBe(1)
        expect(payload.messages[0]?.content[0]).toEqual({
            type: 'document',
            source: {
                type: 'base64',
                media_type: 'application/pdf',
                data: 'pdf-base64',
            },
            cache_control: {
                type: 'ephemeral',
            },
        })
    })
})
