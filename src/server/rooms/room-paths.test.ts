import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { assertSafeRoomPathId, roomFilesystemId } from './room-filesystem-id'

describe('room paths', () => {
    it('rejects room ids that are not safe path segments', () => {
        expect(() => assertSafeRoomPathId('room-1_abc')).not.toThrow()
        expect(() => assertSafeRoomPathId('../system')).toThrow(/safe path segment/)
        expect(() => assertSafeRoomPathId('room/child')).toThrow(/safe path segment/)
        expect(() => assertSafeRoomPathId('')).toThrow(/safe path segment/)
    })

    it('uses an opaque deterministic filesystem id instead of the room id', () => {
        const first = roomFilesystemId('room-1_abc')
        const second = roomFilesystemId('room-1_abc')

        expect(first).toBe(second)
        expect(first).toMatch(/^r-[a-f0-9]{32}$/)
        expect(first).not.toContain('room-1_abc')
    })

    it('does not include the room id in production room filesystem paths', async () => {
        const previousDataDir = process.env.AGENT_ROOM_DATA_DIR
        const root = await mkdtemp(join(tmpdir(), 'agent-room-paths-'))
        try {
            process.env.AGENT_ROOM_DATA_DIR = root
            vi.resetModules()
            const { getRoomPaths } = await import('./room-paths')
            const roomId = 'room-visible-id'
            const paths = getRoomPaths(roomId)

            expect(basename(paths.roomRootDir)).toBe(roomFilesystemId(roomId))
            expect(paths.roomRootDir).not.toContain(roomId)
            expect(paths.workspaceDir).not.toContain(roomId)
            expect(paths.storeDir).not.toContain(roomId)
        } finally {
            if (previousDataDir === undefined) {
                delete process.env.AGENT_ROOM_DATA_DIR
            } else {
                process.env.AGENT_ROOM_DATA_DIR = previousDataDir
            }
            vi.resetModules()
            await rm(root, {
                recursive: true,
                force: true,
            })
        }
    })

    it('leaves legacy filesystem roots untouched when only resolving paths', async () => {
        const previousDataDir = process.env.AGENT_ROOM_DATA_DIR
        const root = await mkdtemp(join(tmpdir(), 'agent-room-paths-'))
        try {
            process.env.AGENT_ROOM_DATA_DIR = root
            const roomId = 'legacy-room'
            const legacyRoot = join(root, 'rooms', roomId)
            await mkdir(join(legacyRoot, 'workspace'), {
                recursive: true,
            })

            vi.resetModules()
            const { getRoomPaths } = await import('./room-paths')
            const paths = getRoomPaths(roomId)

            await expect(access(legacyRoot)).resolves.toBeUndefined()
            await expect(access(paths.roomRootDir)).rejects.toThrow()
        } finally {
            if (previousDataDir === undefined) {
                delete process.env.AGENT_ROOM_DATA_DIR
            } else {
                process.env.AGENT_ROOM_DATA_DIR = previousDataDir
            }
            vi.resetModules()
            await rm(root, {
                recursive: true,
                force: true,
            })
        }
    })

    it('migrates legacy room-id filesystem roots during layout materialization', async () => {
        const previousDataDir = process.env.AGENT_ROOM_DATA_DIR
        const root = await mkdtemp(join(tmpdir(), 'agent-room-paths-'))
        try {
            process.env.AGENT_ROOM_DATA_DIR = root
            const roomId = 'legacy-room'
            const legacyRoot = join(root, 'rooms', roomId)
            await mkdir(join(legacyRoot, 'workspace'), {
                recursive: true,
            })
            await writeFile(join(legacyRoot, 'workspace', 'notes.txt'), 'legacy', 'utf8')

            vi.resetModules()
            const { ensureRoomFilesystemLayout } = await import('./room-paths')
            const paths = await ensureRoomFilesystemLayout(roomId)

            await expect(readFile(join(paths.workspaceDir, 'notes.txt'), 'utf8')).resolves.toBe(
                'legacy',
            )
            await expect(access(legacyRoot)).rejects.toThrow()
            expect(paths.roomRootDir).not.toContain(roomId)
        } finally {
            if (previousDataDir === undefined) {
                delete process.env.AGENT_ROOM_DATA_DIR
            } else {
                process.env.AGENT_ROOM_DATA_DIR = previousDataDir
            }
            vi.resetModules()
            await rm(root, {
                recursive: true,
                force: true,
            })
        }
    })
})
