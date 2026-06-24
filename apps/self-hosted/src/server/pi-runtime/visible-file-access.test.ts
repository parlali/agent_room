import { lstat, mkdtemp, mkdir, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import {
    deleteVisibleFileNoFollow,
    readVisibleFileNoFollow,
    writeVisibleFileNoFollow,
} from './visible-file-access'

describe('visible runtime file access', () => {
    it('rejects writes through symlinked parent directories', async () => {
        const root = await mkdtemp(join(tmpdir(), 'agent-room-visible-files-'))
        const outside = await mkdtemp(join(tmpdir(), 'agent-room-visible-outside-'))
        await symlink(outside, join(root, 'link'))

        await expect(
            writeVisibleFileNoFollow({
                root,
                path: join(root, 'link', 'nested', 'secret.txt'),
                content: new TextEncoder().encode('secret'),
                mode: 0o600,
            }),
        ).rejects.toThrow(/symbolic link/)
        await expect(lstat(join(outside, 'nested'))).rejects.toMatchObject({
            code: 'ENOENT',
        })
    })

    it('rejects reads and deletes of symlinked files', async () => {
        const root = await mkdtemp(join(tmpdir(), 'agent-room-visible-files-'))
        const outside = await mkdtemp(join(tmpdir(), 'agent-room-visible-outside-'))
        await mkdir(join(root, 'workspace'))
        await writeFile(join(outside, 'secret.txt'), 'secret')
        await symlink(join(outside, 'secret.txt'), join(root, 'workspace', 'secret.txt'))

        await expect(
            readVisibleFileNoFollow({
                root,
                path: join(root, 'workspace', 'secret.txt'),
            }),
        ).rejects.toThrow()
        await expect(
            deleteVisibleFileNoFollow({
                root,
                path: join(root, 'workspace', 'secret.txt'),
            }),
        ).rejects.toThrow()
    })
})
