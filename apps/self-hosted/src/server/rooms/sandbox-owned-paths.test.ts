import { mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { RuntimeSandboxIdentity } from '#/domain/domain-types'
import { ensureSandboxOwnedFile } from './sandbox-owned-paths'

const disabledIdentity: RuntimeSandboxIdentity = {
    mode: 'disabled',
    uid: null,
    gid: null,
    userName: null,
    groupName: null,
}

describe('sandbox owned paths', () => {
    let root: string

    beforeEach(async () => {
        root = await mkdtemp(join(tmpdir(), 'agent-room-sandbox-owned-'))
    })

    afterEach(async () => {
        await rm(root, {
            recursive: true,
            force: true,
        })
    })

    it('creates missing files before enforcing file ownership and mode', async () => {
        const path = join(root, 'nested', 'created.txt')

        await ensureSandboxOwnedFile({
            path,
            roots: [root],
            identity: disabledIdentity,
        })

        await expect(readFile(path, 'utf8')).resolves.toBe('')
        expect((await stat(path)).mode & 0o777).toBe(0o600)
    })

    it('rejects non-file targets after directory materialization races', async () => {
        const target = join(root, 'target.txt')
        await mkdir(target)

        await expect(
            ensureSandboxOwnedFile({
                path: target,
                roots: [root],
                identity: disabledIdentity,
            }),
        ).rejects.toThrow(/not a file/)
    })

    it('rejects symlink files without following them', async () => {
        const outside = join(root, 'outside.txt')
        const link = join(root, 'link.txt')
        await writeFile(outside, 'outside', 'utf8')
        await symlink(outside, link)

        await expect(
            ensureSandboxOwnedFile({
                path: link,
                roots: [root],
                identity: disabledIdentity,
            }),
        ).rejects.toThrow(/not a file/)
    })
})
