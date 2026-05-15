import { readFileSync } from 'node:fs'
import {
    createExtensionRuntime,
    loadSkillsFromDir,
    stripFrontmatter,
    type ResourceLoader,
    type Skill,
} from '@mariozechner/pi-coding-agent'
import { bundledSkillsDirectory } from './bundled-skills'

const agentRoomSkills = loadSkillsFromDir({
    dir: bundledSkillsDirectory(),
    source: 'project',
})

/**
 * Builds an appended system-prompt section describing the bundled Agent Room skills.
 *
 * Each provided skill is converted into a `<skill>` block that includes the skill name,
 * file location, a note about relative references, and the skill content with frontmatter removed.
 *
 * @param skills - The list of bundled skills to include in the prompt section.
 * @returns A single-element `string[]` containing the assembled "Agent Room bundled skills" prompt block, or an empty array if `skills` is empty.
 */
function agentRoomSkillPrompt(skills: Skill[]): string[] {
    if (skills.length === 0) {
        return []
    }
    const sections = skills.map((skill) => {
        const content = stripFrontmatter(readFileSync(skill.filePath, 'utf8')).trim()
        return [
            `<skill name="${skill.name}" location="${skill.filePath}">`,
            `References are relative to ${skill.baseDir}.`,
            '',
            content,
            '</skill>',
        ].join('\n')
    })
    return [
        [
            'Agent Room bundled skills:',
            'These skills are reviewed and shipped with Agent Room. Use them when their descriptions match; do not fetch remote, marketplace, user-installed, or third-party skills for these workflows.',
            sections.join('\n\n'),
        ].join('\n\n'),
    ]
}

/**
 * Create a ResourceLoader exposing the preloaded Agent Room bundled skills and default minimal resources.
 *
 * @param systemPrompt - A string or zero-argument function that provides the base system prompt; if a function is supplied it will be invoked when the loader's system prompt is requested.
 * @returns A ResourceLoader object whose methods provide:
 * - getExtensions: an empty extensions list with a runtime and no errors.
 * - getSkills: the preloaded bundled skills and their diagnostics.
 * - getPrompts: empty prompts and diagnostics.
 * - getThemes: empty themes and diagnostics.
 * - getAgentsFiles: an empty agentsFiles array.
 * - getSystemPrompt: the provided system prompt string or the result of invoking the function.
 * - getAppendSystemPrompt: formatted Agent Room bundled skills suitable for appending to a system prompt.
 * - extendResources: a no-op extension hook.
 * - reload: a no-op reload hook.
 */
export function createPiResourceLoader(systemPrompt: string | (() => string)): ResourceLoader {
    return {
        getExtensions: () => ({
            extensions: [],
            errors: [],
            runtime: createExtensionRuntime(),
        }),
        getSkills: () => ({
            skills: agentRoomSkills.skills,
            diagnostics: agentRoomSkills.diagnostics,
        }),
        getPrompts: () => ({
            prompts: [],
            diagnostics: [],
        }),
        getThemes: () => ({
            themes: [],
            diagnostics: [],
        }),
        getAgentsFiles: () => ({
            agentsFiles: [],
        }),
        getSystemPrompt: () => (typeof systemPrompt === 'function' ? systemPrompt() : systemPrompt),
        getAppendSystemPrompt: () => agentRoomSkillPrompt(agentRoomSkills.skills),
        extendResources: () => {},
        reload: async () => {},
    }
}
