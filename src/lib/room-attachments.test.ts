import { describe, expect, it } from 'vitest'
import { parseRoomMessageAttachments } from './room-attachments'

describe('room attachments', () => {
    it('extracts attached file lines from display text', () => {
        const parsed = parseRoomMessageAttachments(
            [
                'Please inspect these.',
                '',
                'Attached files:',
                '- product-spec.docx (9.7 KB) root=store path="attachments/session/product-spec.docx"',
                '- map.png (12 KB) root=workspace path="screens/map.png"',
            ].join('\n'),
        )

        expect(parsed.text).toBe('Please inspect these.')
        expect(parsed.attachments).toEqual([
            {
                id: 'store:attachments/session/product-spec.docx',
                name: 'product-spec.docx',
                surface: 'store',
                relativePath: 'attachments/session/product-spec.docx',
                byteLength: null,
                sizeLabel: '9.7 KB',
            },
            {
                id: 'workspace:screens/map.png',
                name: 'map.png',
                surface: 'workspace',
                relativePath: 'screens/map.png',
                byteLength: null,
                sizeLabel: '12 KB',
            },
        ])
    })
})
