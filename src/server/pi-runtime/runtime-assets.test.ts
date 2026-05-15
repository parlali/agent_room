import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import { copyRuntimeAssets } from '../../../scripts/copy-runtime-assets'

async function exists(path: string): Promise<boolean> {
    try {
        await access(path)
        return true
    } catch {
        return false
    }
}

describe('runtime assets', () => {
    it('copies bundled skills into the production server assets directory', async () => {
        const root = await mkdtemp(join(tmpdir(), 'agent-room-runtime-assets-'))
        try {
            const source = join(root, 'src/server/pi-runtime/skills/office-documents')
            await mkdir(join(source, 'scripts'), {
                recursive: true,
            })
            await writeFile(join(source, 'SKILL.md'), 'office skill', 'utf8')
            await writeFile(join(source, 'scripts/office_document.py'), 'print("ok")', 'utf8')
            const legacy = join(root, 'dist/server/skills/office-documents')
            await mkdir(legacy, {
                recursive: true,
            })
            await writeFile(join(legacy, 'SKILL.md'), 'stale', 'utf8')

            await copyRuntimeAssets(root)

            expect(
                await readFile(
                    join(root, 'dist/server/assets/skills/office-documents/SKILL.md'),
                    'utf8',
                ),
            ).toBe('office skill')
            expect(
                await readFile(
                    join(
                        root,
                        'dist/server/assets/skills/office-documents/scripts/office_document.py',
                    ),
                    'utf8',
                ),
            ).toBe('print("ok")')
            expect(await exists(join(root, 'dist/server/skills'))).toBe(false)
        } finally {
            await rm(root, {
                recursive: true,
                force: true,
            })
        }
    })
})
