import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import {
    createExtensionRuntime,
    loadSkillsFromDir,
    stripFrontmatter,
    type ResourceLoader,
    type Skill,
} from '@mariozechner/pi-coding-agent'

const agentRoomSkillDirectory = fileURLToPath(new URL('./skills', import.meta.url))
const agentRoomSkills = loadSkillsFromDir({
    dir: agentRoomSkillDirectory,
    source: 'project',
})

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
