import { access, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

describe('room file store', () => {
    let root: string
    let previousDataDir: string | undefined

    beforeEach(async () => {
        vi.resetModules()
        root = await mkdtemp(join(tmpdir(), 'agent-room-file-store-'))
        previousDataDir = process.env.AGENT_ROOM_DATA_DIR
        process.env.AGENT_ROOM_DATA_DIR = root
    })

    afterEach(async () => {
        if (previousDataDir === undefined) {
            delete process.env.AGENT_ROOM_DATA_DIR
        } else {
            process.env.AGENT_ROOM_DATA_DIR = previousDataDir
        }
        await rm(root, {
            recursive: true,
            force: true,
        })
    })

    it('does not list symlinks and reads previews without loading the whole file', async () => {
        const { getRoomPaths } = await import('./room-paths')
        const { listRoomDirectory, listRoomFiles, listRoomFileTree } = await import('./file-store')
        const { readRoomFileContent, readRoomFilePreviewAsset } =
            await import('./file-store-preview')
        const paths = getRoomPaths('room-files')
        await mkdir(paths.workspaceDir, {
            recursive: true,
        })
        await mkdir(join(paths.workspaceDir, 'notes'), {
            recursive: true,
        })
        await mkdir(join(paths.storeDir, 'blobs'), {
            recursive: true,
        })
        await mkdir(join(paths.storeDir, 'previews'), {
            recursive: true,
        })
        await writeFile(join(paths.workspaceDir, 'large.txt'), Buffer.alloc(600000, 'a'))
        await writeFile(join(paths.workspaceDir, 'notes', 'daily.md'), '# Daily', 'utf8')
        await writeFile(join(paths.workspaceDir, 'fake.xlsx'), Buffer.from('PK fake office file'))
        await writeFile(
            join(paths.workspaceDir, 'pixel.png'),
            Buffer.from(
                'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=',
                'base64',
            ),
        )
        await writeFile(join(paths.storeDir, 'upload.txt'), 'uploaded', 'utf8')
        await writeFile(join(paths.storeDir, 'blobs', 'hidden.txt'), 'hidden', 'utf8')
        await writeFile(join(paths.storeDir, 'previews', 'hidden.png'), 'hidden', 'utf8')
        await writeFile(join(root, 'outside.txt'), 'outside', 'utf8')
        await symlink(join(root, 'outside.txt'), join(paths.workspaceDir, 'outside-link.txt'))

        const files = await listRoomFiles('room-files')
        const listedPaths = files.map((file) => `${file.surface}:${file.relativePath}`)
        expect(listedPaths).toContain('workspace:large.txt')
        expect(listedPaths).toContain('workspace:notes/daily.md')
        expect(listedPaths).toContain('workspace:fake.xlsx')
        expect(listedPaths).toContain('workspace:pixel.png')
        expect(listedPaths).toContain('store:upload.txt')
        expect(listedPaths).not.toContain('workspace:outside-link.txt')
        expect(listedPaths).not.toContain('store:blobs/hidden.txt')
        expect(listedPaths).not.toContain('store:previews/hidden.png')

        const directory = await listRoomDirectory({
            roomId: 'room-files',
            surface: 'workspace',
        })
        expect(directory.entries.map((entry) => entry.relativePath)).toEqual([
            'notes',
            'fake.xlsx',
            'large.txt',
            'pixel.png',
        ])

        const tree = await listRoomFileTree('room-files')
        expect(tree.roots.find((node) => node.surface === 'workspace')?.children[0]?.name).toBe(
            'notes',
        )

        const preview = await readRoomFileContent({
            roomId: 'room-files',
            surface: 'workspace',
            relativePath: 'large.txt',
        })
        expect(preview.kind).toBe('text')
        if (preview.kind !== 'text') {
            throw new Error('Expected text preview')
        }
        expect(preview.byteLength).toBe(600000)
        expect(preview.truncated).toBe(true)
        expect(Buffer.byteLength(preview.content)).toBeLessThanOrEqual(512000)

        const officePreview = await readRoomFileContent({
            roomId: 'room-files',
            surface: 'workspace',
            relativePath: 'fake.xlsx',
        })
        expect(officePreview.kind).not.toBe('text')

        const imagePreview = await readRoomFilePreviewAsset({
            roomId: 'room-files',
            surface: 'workspace',
            relativePath: 'pixel.png',
        })
        expect(imagePreview.mediaType).toBe('image/png')
        expect(imagePreview.content.byteLength).toBeGreaterThan(0)
    })

    it('writes uploaded files into visible room directories without overwriting', async () => {
        const { getRoomPaths } = await import('./room-paths')
        const { listRoomDirectory, writeRoomUploadedFile } = await import('./file-store')
        const paths = getRoomPaths('room-files')

        const uploaded = await writeRoomUploadedFile({
            roomId: 'room-files',
            surface: 'store',
            relativeDirectory: 'incoming/nested',
            fileName: 'notes.txt',
            content: Buffer.from('hello upload'),
        })

        expect(uploaded.surface).toBe('store')
        expect(uploaded.relativePath).toBe('incoming/nested/notes.txt')
        expect(
            await readFile(join(paths.storeDir, 'incoming', 'nested', 'notes.txt'), 'utf8'),
        ).toBe('hello upload')

        const directory = await listRoomDirectory({
            roomId: 'room-files',
            surface: 'store',
            relativePath: 'incoming/nested',
        })
        expect(directory.entries.map((entry) => entry.relativePath)).toEqual([
            'incoming/nested/notes.txt',
        ])

        await expect(
            writeRoomUploadedFile({
                roomId: 'room-files',
                surface: 'store',
                relativeDirectory: 'incoming/nested',
                fileName: 'notes.txt',
                content: Buffer.from('overwrite'),
            }),
        ).rejects.toThrow(/File already exists/)

        await expect(
            writeRoomUploadedFile({
                roomId: 'room-files',
                surface: 'store',
                relativeDirectory: 'blobs',
                fileName: 'hidden.txt',
                content: Buffer.from('hidden'),
            }),
        ).rejects.toThrow(/internal store paths/)

        await expect(
            writeRoomUploadedFile({
                roomId: 'room-files',
                surface: 'store',
                relativeDirectory: 'blobs\\nested',
                fileName: 'hidden.txt',
                content: Buffer.from('hidden'),
            }),
        ).rejects.toThrow(/internal store paths/)

        await expect(
            writeRoomUploadedFile({
                roomId: 'room-files',
                surface: 'store',
                relativeDirectory: 'incoming/../blobs',
                fileName: 'hidden.txt',
                content: Buffer.from('hidden'),
            }),
        ).rejects.toThrow(/internal store paths/)
    })

    it('does not create upload directories through symlinks', async () => {
        const { getRoomPaths } = await import('./room-paths')
        const { writeRoomUploadedFile } = await import('./file-store')
        const paths = getRoomPaths('room-files')
        const outside = join(root, 'outside')
        await mkdir(paths.storeDir, {
            recursive: true,
        })
        await mkdir(outside)
        await symlink(outside, join(paths.storeDir, 'linked'))

        await expect(
            writeRoomUploadedFile({
                roomId: 'room-files',
                surface: 'store',
                relativeDirectory: 'linked/nested',
                fileName: 'escape.txt',
                content: Buffer.from('escape'),
            }),
        ).rejects.toThrow(/Upload target is not a directory/)
        await expect(access(join(outside, 'nested'))).rejects.toThrow()
    })

    it('removes a newly uploaded file when sandbox materialization fails', async () => {
        vi.doMock('./runtime-sandbox-identity', () => ({
            ensureMaterializedRuntimeSandboxDirectory: vi.fn(
                async (_paths: unknown, path: string) => {
                    await mkdir(path, {
                        recursive: true,
                    })
                },
            ),
            ensureMaterializedRuntimeSandboxFile: vi.fn(async () => {
                throw new Error('sandbox materialization failed')
            }),
        }))
        const { getRoomPaths } = await import('./room-paths')
        const { writeRoomUploadedFile } = await import('./file-store')
        const paths = getRoomPaths('room-files')

        await expect(
            writeRoomUploadedFile({
                roomId: 'room-files',
                surface: 'store',
                relativeDirectory: 'incoming',
                fileName: 'notes.txt',
                content: Buffer.from('hello upload'),
            }),
        ).rejects.toThrow(/sandbox materialization failed/)

        await expect(access(join(paths.storeDir, 'incoming', 'notes.txt'))).rejects.toThrow()
        vi.doUnmock('./runtime-sandbox-identity')
    })
})
