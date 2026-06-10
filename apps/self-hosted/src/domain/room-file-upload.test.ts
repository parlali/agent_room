import { afterEach, describe, expect, it, vi } from 'vitest'
import { roomFileUploadPolicy } from './room-file-upload-policy'
import { uploadRoomFiles } from '#/lib/room-file-upload'

function uploadFile(size: number, name = 'upload.txt'): File {
    return {
        name,
        size,
    } as File
}

describe('uploadRoomFiles', () => {
    afterEach(() => {
        vi.unstubAllGlobals()
    })

    it('rejects files before fetch when the request violates upload policy', async () => {
        const fetchMock = vi.fn()
        vi.stubGlobal('fetch', fetchMock)

        await expect(
            uploadRoomFiles({
                roomId: 'room-1',
                files: [uploadFile(roomFileUploadPolicy.maxBytesPerFile + 1, 'large.png')],
            }),
        ).rejects.toMatchObject({
            code: 'file_too_large',
        })
        expect(fetchMock).not.toHaveBeenCalled()
    })
})
