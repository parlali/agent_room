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
            const source = join(root, 'src/server/pi-runtime/skills/docx')
            await mkdir(join(source, 'scripts'), {
                recursive: true,
            })
            await writeFile(join(source, 'SKILL.md'), 'docx skill', 'utf8')
            await writeFile(join(source, 'scripts/docx_document.ts'), 'console.log("ok")', 'utf8')
            await mkdir(join(root, 'src/server/pi-runtime/skills/.shared'), {
                recursive: true,
            })
            await writeFile(
                join(root, 'src/server/pi-runtime/skills/.shared/office.ts'),
                'export {}',
                'utf8',
            )
            const legacy = join(root, 'dist/server/skills/docx')
            await mkdir(legacy, {
                recursive: true,
            })
            await writeFile(join(legacy, 'SKILL.md'), 'stale', 'utf8')

            await copyRuntimeAssets(root)

            expect(
                await readFile(join(root, 'dist/server/assets/skills/docx/SKILL.md'), 'utf8'),
            ).toBe('docx skill')
            expect(
                await readFile(
                    join(root, 'dist/server/assets/skills/docx/scripts/docx_document.ts'),
                    'utf8',
                ),
            ).toBe('console.log("ok")')
            expect(
                await readFile(join(root, 'dist/server/assets/skills/.shared/office.ts'), 'utf8'),
            ).toBe('export {}')
            expect(await exists(join(root, 'dist/server/skills'))).toBe(false)
        } finally {
            await rm(root, {
                recursive: true,
                force: true,
            })
        }
    })
})
