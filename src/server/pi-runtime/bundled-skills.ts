import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

const skillDirectoryCandidates = [
    fileURLToPath(new URL('./skills', import.meta.url)),
    fileURLToPath(new URL('./assets/skills', import.meta.url)),
    join(process.cwd(), 'dist/server/assets/skills'),
    join(process.cwd(), 'src/server/pi-runtime/skills'),
]

/**
 * Selects the first existing directory from the predefined bundled-skill candidates.
 *
 * @returns The filesystem path of the found bundled skills directory.
 * @throws Error if none of the candidate directories exist.
 */
export function bundledSkillsDirectory(): string {
    const directory = skillDirectoryCandidates.find((candidate) => existsSync(candidate))
    if (!directory) {
        throw new Error('Agent Room bundled skills directory was not found')
    }
    return directory
}

/**
 * Resolve the filesystem path to a bundled skill's script.
 *
 * @param skillName - The bundled skill's directory name
 * @param scriptPath - The relative path to the script inside the skill directory
 * @returns The absolute filesystem path to the specified script
 * @throws Error if the resolved script path does not exist (message: `Agent Room bundled skill script was not found: ${skillName}/${scriptPath}`)
 */
export function bundledSkillScriptPath(skillName: string, scriptPath: string): string {
    const path = join(bundledSkillsDirectory(), skillName, scriptPath)
    if (!existsSync(path)) {
        throw new Error(`Agent Room bundled skill script was not found: ${skillName}/${scriptPath}`)
    }
    return path
}
