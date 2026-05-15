import { cp, mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'

const source = join(process.cwd(), 'src/server/pi-runtime/skills')
const target = join(process.cwd(), 'dist/server/assets/skills')
const legacyTarget = join(process.cwd(), 'dist/server/skills')

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
