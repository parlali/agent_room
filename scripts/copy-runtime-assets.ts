import { cp, mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

export async function copyRuntimeAssets(root = process.cwd()): Promise<void> {
    const source = join(root, 'src/server/pi-runtime/skills')
    const target = join(root, 'dist/server/assets/skills')
    const legacyTarget = join(root, 'dist/server/skills')

    await rm(target, {
        recursive: true,
        force: true,
    })
    await rm(legacyTarget, {
        recursive: true,
        force: true,
    })
    await mkdir(target, {
        recursive: true,
    })
    await cp(source, target, {
        recursive: true,
    })
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    await copyRuntimeAssets()
}
