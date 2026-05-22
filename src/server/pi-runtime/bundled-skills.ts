import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

function productionSkillDirectoryCandidates(): string[] {
    return [
        join(process.cwd(), 'dist/server/assets/skills'),
        fileURLToPath(new URL('../assets/skills', import.meta.url)),
        fileURLToPath(new URL('./assets/skills', import.meta.url)),
    ]
}

function developmentSkillDirectoryCandidates(): string[] {
    return [
        fileURLToPath(new URL('./skills', import.meta.url)),
        join(process.cwd(), 'src/server/pi-runtime/skills'),
        ...productionSkillDirectoryCandidates(),
    ]
}

export function bundledSkillsDirectory(): string {
    const skillDirectoryCandidates =
        process.env.NODE_ENV === 'production'
            ? productionSkillDirectoryCandidates()
            : developmentSkillDirectoryCandidates()
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
