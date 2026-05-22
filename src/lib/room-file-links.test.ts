import { describe, expect, it } from 'vitest'
import {
    roomFileEntryDownloadUrl,
    roomFileEntryPreviewDownloadUrl,
    roomFileEntryPreviewUrl,
} from './room-file-links'
import type { RoomFileEntry } from './room-file-types'

const entry: RoomFileEntry = {
    name: 'Report Q1.docx',
    relativePath: 'deliverables/Report Q1.docx',
    surface: 'workspace',
    kind: 'file',
    byteLength: 1200,
    updatedAt: '2026-05-22T00:00:00.000Z',
}

describe('room file links', () => {
    it('keeps original and generated preview downloads explicit', () => {
        expect(roomFileEntryPreviewUrl('room 1', entry)).toBe(
            '/api/rooms/room%201/files/preview?surface=workspace&path=deliverables%2FReport+Q1.docx',
        )
        expect(roomFileEntryDownloadUrl('room 1', entry)).toBe(
            '/api/rooms/room%201/files/preview?surface=workspace&path=deliverables%2FReport+Q1.docx&download=1',
        )
        expect(roomFileEntryPreviewDownloadUrl('room 1', entry)).toBe(
            '/api/rooms/room%201/files/preview?surface=workspace&path=deliverables%2FReport+Q1.docx&download=preview',
        )
    })
})
