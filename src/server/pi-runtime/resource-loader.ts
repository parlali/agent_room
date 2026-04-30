import { createExtensionRuntime, type ResourceLoader } from '@mariozechner/pi-coding-agent'

export function createPiResourceLoader(systemPrompt: string | (() => string)): ResourceLoader {
    return {
        getExtensions: () => ({
            extensions: [],
            errors: [],
            runtime: createExtensionRuntime(),
        }),
        getSkills: () => ({
            skills: [],
            diagnostics: [],
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
        getAppendSystemPrompt: () => [],
        extendResources: () => {},
        reload: async () => {},
    }
}
