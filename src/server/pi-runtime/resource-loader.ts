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
            'Workspace read/list/search tools only access the room workspace. Use skill_list, skill_read, and skill_search to inspect bundled skill files and scripts.',
            'Bundled Office skills are Bun/TypeScript tools. Do not switch to Python Office libraries for DOCX, XLSX, or PPTX generation.',
            sections.join('\n\n'),
        ].join('\n\n'),
    ]
}

const cachedAgentRoomSkillPrompt = agentRoomSkillPrompt(agentRoomSkills.skills)

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
        getAppendSystemPrompt: () => cachedAgentRoomSkillPrompt,
        extendResources: () => {},
        reload: async () => {},
    }
}
