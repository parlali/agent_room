import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
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
        const { listRoomFiles, readRoomFileContent } = await import('./file-store')
        const paths = getRoomPaths('room-files')
        await mkdir(paths.workspaceDir, {
            recursive: true,
        })
        await writeFile(join(paths.workspaceDir, 'large.txt'), Buffer.alloc(600000, 'a'))
        await writeFile(join(root, 'outside.txt'), 'outside', 'utf8')
        await symlink(join(root, 'outside.txt'), join(paths.workspaceDir, 'outside-link.txt'))

        const files = await listRoomFiles('room-files')
        expect(files.map((file) => file.relativePath)).toContain('large.txt')
        expect(files.map((file) => file.relativePath)).not.toContain('outside-link.txt')

        const preview = await readRoomFileContent({
            roomId: 'room-files',
            surface: 'workspace',
            relativePath: 'large.txt',
        })
        expect(preview.byteLength).toBe(600000)
        expect(preview.truncated).toBe(true)
        expect(Buffer.byteLength(preview.content)).toBeLessThanOrEqual(512000)
    })
})
