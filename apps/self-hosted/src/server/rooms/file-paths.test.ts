import { describe, expect, it } from 'vitest'
import { normalizeRoomFileRelativePath } from './file-paths'

describe('room file path helpers', () => {
    it('rejects visible file path traversal', () => {
        expect(() => normalizeRoomFileRelativePath('/etc/passwd')).toThrow(/escapes/)
        expect(() => normalizeRoomFileRelativePath('notes/../secret.txt')).toThrow(/escapes/)
    })
})
