import { describe, expect, it } from 'vitest'
import { isInternalStoreRelativePath, shouldExposeStoreRelativePath } from './room-store-visibility'

describe('room store visibility', () => {
    it('treats non-canonical internal store paths as internal', () => {
        expect(isInternalStoreRelativePath('blobs/file.txt')).toBe(true)
        expect(isInternalStoreRelativePath('./blobs/file.txt')).toBe(true)
        expect(isInternalStoreRelativePath('blobs\\file.txt')).toBe(true)
        expect(isInternalStoreRelativePath('nested/blobs/file.txt')).toBe(false)
    })

    it('fails closed for invalid relative store paths while keeping the root visible', () => {
        expect(shouldExposeStoreRelativePath('')).toBe(true)
        expect(shouldExposeStoreRelativePath('.')).toBe(true)
        expect(shouldExposeStoreRelativePath('../blobs/file.txt')).toBe(false)
        expect(shouldExposeStoreRelativePath('public/../blobs/file.txt')).toBe(false)
        expect(shouldExposeStoreRelativePath('/blobs/file.txt')).toBe(false)
    })
})
