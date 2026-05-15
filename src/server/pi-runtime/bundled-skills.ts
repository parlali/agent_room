import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

const skillDirectoryCandidates = [
    fileURLToPath(new URL('./skills', import.meta.url)),
    fileURLToPath(new URL('../assets/skills', import.meta.url)),
    fileURLToPath(new URL('./assets/skills', import.meta.url)),
    join(process.cwd(), 'dist/server/assets/skills'),
    join(process.cwd(), 'src/server/pi-runtime/skills'),
]

export function bundledSkillsDirectory(): string {
    const directory = skillDirectoryCandidates.find((candidate) => existsSync(candidate))
    if (!directory) {
        throw new Error('Agent Room bundled skills directory was not found')
    }
    return directory
}

export function bundledSkillScriptPath(skillName: string, scriptPath: string): string {
    const path = join(bundledSkillsDirectory(), skillName, scriptPath)
    if (!existsSync(path)) {
        throw new Error(`Agent Room bundled skill script was not found: ${skillName}/${scriptPath}`)
    }
    return path
}
