import { describe, expect, it } from 'vitest'
import {
    roomFileUploadPolicy,
    RoomFileUploadPolicyError,
    validateRoomFileUpload,
} from './room-file-upload-policy'

function file(size: number, name = 'upload.txt') {
    return {
        name,
        size,
    }
}

describe('room file upload policy', () => {
    it('rejects empty upload requests', () => {
        expect(() => validateRoomFileUpload([])).toThrow(RoomFileUploadPolicyError)
        try {
            validateRoomFileUpload([])
        } catch (error) {
            expect(error).toMatchObject({
                code: 'empty_upload',
            })
        }
    })

    it('rejects too many files from the canonical limit', () => {
        const files = Array.from({ length: roomFileUploadPolicy.maxFilesPerRequest + 1 }, () =>
            file(1),
        )

        expect(() => validateRoomFileUpload(files)).toThrow(
            `Upload is limited to ${roomFileUploadPolicy.maxFilesPerRequest} files`,
        )
    })

    it('rejects one oversized file before accepting the request total', () => {
        expect(() =>
            validateRoomFileUpload([file(roomFileUploadPolicy.maxBytesPerFile + 1, 'large.png')]),
        ).toThrow(/large\.png/)
    })

    it('rejects upload requests above the total byte limit', () => {
        const belowPerFileLimit = Math.floor(roomFileUploadPolicy.maxBytesPerRequest / 3) + 1

        expect(() =>
            validateRoomFileUpload([
                file(belowPerFileLimit, 'first.bin'),
                file(belowPerFileLimit, 'second.bin'),
                file(belowPerFileLimit, 'third.bin'),
            ]),
        ).toThrow('Upload is limited to 100 MB per request')
    })
})
