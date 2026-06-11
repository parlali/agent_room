import type { PiRuntimeConfig } from '../rooms/pi-runtime-config'
import { resolveArchetypeParagraph } from '../rooms/personality/archetypes'
import { personalityInstructionLines, sanitizePersonalityForm } from '../rooms/personality/form'
import { buildAgentHarnessPrompt } from './agent-harness'
import { boundTextByChars } from './bounded-text'
import { buildInternalStateSummary } from './internal-state'
import { readMemory } from './memory'
import { internalStateToolNames } from './internal-state-tools'
import { nativeWorkspaceToolNamesForCapabilities, roomToolNamesForCapabilities } from './room-tools'

export interface ContextBudget {
    maxInputTokens: number
    reservedOutputTokens: number
    systemPromptMaxChars: number
}

const MAX_OPERATOR_INSTRUCTIONS_CHARS = 24000
const mainThreadOrchestrationToolNames = ['subagent', 'deep_work'] as const

function boundedText(
    input: string,
    maxChars: number,
): {
    text: string
    truncated: boolean
} {
    return boundTextByChars(input, maxChars)
}

export function contextBudgetForProvider(config: PiRuntimeConfig): ContextBudget {
    void config
    const maxInputTokens = 128000
    const reservedOutputTokens = Math.min(16384, Math.max(4096, Math.floor(maxInputTokens * 0.15)))
    return {
        maxInputTokens,
        reservedOutputTokens,
        systemPromptMaxChars: Math.min(48000, Math.floor(maxInputTokens * 0.6)),
    }
}

function githubRepositoryInstruction(config: PiRuntimeConfig): string | null {
    if (!config.github.enabled || config.github.repositories.length === 0) {
        return null
    }

    const repositories = config.github.repositories.join(', ')
    const remotes = config.github.repositories
        .map((repository) => `https://github.com/${repository}.git`)
        .join(', ')
    return [
        'GitHub repository access:',
        `GitHub is connected for ${repositories}.`,
        `Available HTTPS remotes: ${remotes}.`,
        'The workspace may be empty until you clone a selected repository.',
        'Do not treat an empty workspace or "fatal: not a git repository" as missing GitHub access.',
        'To verify access, run git ls-remote against the selected HTTPS remote.',
        'Clone the selected repository when repository files are needed.',
        'The gh CLI is installed and authenticated through room-local GitHub App installation credentials for these repositories.',
        'Use GH_PROMPT_DISABLED=1 gh with explicit --repo owner/repo for issue, pull request, release, workflow, and repository API operations.',
        'Do not use gh auth login, gh auth status, or gh api user as capability checks; GitHub App installation tokens are repository-scoped and user identity endpoints can fail with 403 even when repository operations work.',
        'Verify gh access with repo-scoped commands such as GH_PROMPT_DISABLED=1 gh repo view owner/repo --json nameWithOwner or GH_PROMPT_DISABLED=1 gh issue list --repo owner/repo --limit 1.',
        'Do not print or persist tokens.',
    ].join(' ')
}

function runtimeContextSection(config: PiRuntimeConfig, budget: ContextBudget, now: Date): string {
    return [
        `Current datetime: ${now.toISOString()}`,
        `Timezone: ${Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'}`,
        `Provider: ${config.provider.sourceProvider}`,
        `Model: ${config.provider.sourceModel}`,
        `Mode: ${config.roomMode}`,
        `Context budget: ${budget.maxInputTokens} input tokens with ${budget.reservedOutputTokens} reserved for output`,
    ].join('\n')
}

function attachmentHandlingInstruction(config: PiRuntimeConfig): string {
    const pdfInstruction = config.capabilities.pdf
        ? 'Attached PDFs are provided through native PDF input when the configured provider supports it, otherwise as rendered page images for vision-capable models; use read_pdf for PDF paths and report the limitation clearly if the PDF read tool reports that native or rendered reading is unavailable.'
        : 'Attached PDFs may be unavailable for native reading in this runtime configuration; proceed with available attachment inputs and report the limitation clearly when PDF content is not available.'
    return [
        'Attached images are provided as direct visual input; use that input for image understanding.',
        'Do not inspect images with shell commands, OCR, conversion utilities, package installs, or storage paths.',
        pdfInstruction,
        'Attached non-image, non-PDF files are workspace file references; when a root and path are shown, use the appropriate file, document, skill, or shell tools to inspect them only as needed.',
        'If an attachment cannot be accessed through either path, stop and report the limitation clearly.',
    ].join(' ')
}

function artifactRoutingSection(config: PiRuntimeConfig): string {
    const hasOfficeCapability =
        config.capabilities.documents ||
        config.capabilities.spreadsheets ||
        config.capabilities.presentations
    const lines = [
        'Artifact routing:',
        hasOfficeCapability
            ? 'Use the bundled Office skills as the default editable source for normal business artifacts.'
            : null,
        config.capabilities.documents
            ? 'Document, report, memo, brief, proposal, white paper, and spec requests create or edit DOCX through the bundled docx skill unless the operator explicitly asks for another source format.'
            : null,
        config.capabilities.spreadsheets
            ? 'Spreadsheet, tracker, model, budget, and workbook requests create or edit XLSX through the bundled xlsx skill unless the operator explicitly asks for another source format.'
            : null,
        config.capabilities.presentations
            ? 'Deck, slides, and presentation requests create or edit PPTX through the bundled pptx skill unless the operator explicitly asks for another source format.'
            : null,
        config.capabilities.pdf && hasOfficeCapability
            ? 'For normal business PDF requests, create or preserve the editable Office source first, then export or convert to PDF as the delivery format.'
            : null,
        hasOfficeCapability
            ? 'After creating or editing DOCX, XLSX, or PPTX artifacts, run the matching bundled skill inspect, validate, and render operations; fix non-empty inspect issues and visible rendered page or slide PNG defects before delivery.'
            : null,
        hasOfficeCapability
            ? 'For non-trivial Office content, write JSON input files and pass them with the skill file-input options instead of fighting shell quoting.'
            : null,
        'Use HTML, Markdown, plain text, custom PDF generation, or other renderers only when explicitly requested or when a bounded renderer is required by the task.',
        hasOfficeCapability
            ? 'Do not deliberate across multiple artifact formats when the request clearly maps to DOCX, XLSX, or PPTX.'
            : null,
    ]

    return lines.filter((line): line is string => line !== null).join('\n')
}

function identitySection(config: PiRuntimeConfig): string {
    return [
        `You are ${config.runtime.displayName}, a standalone agent working in one workspace.`,
        'Read the request, investigate what matters, and come back with useful work done.',
        'You think in outcomes, evidence, and follow-through instead of primers, taxonomies, or generic advice.',
    ].join('\n')
}

function initiativeSection(): string {
    return [
        'Initiative:',
        'Take safe obvious next steps before the final report when the next step is clearly implied, safe, and in scope.',
        'If progress requires user judgment, ask one specific blocker question instead of producing a long report.',
        'If the task is complete, return a concise completed report without an open-ended follow-up prompt.',
        'Do not append generic "we can do this next" menus after completed work.',
    ].join('\n')
}

function behaviorSection(): string {
    return [
        'Behavior:',
        initiativeSection(),
        'Lead final responses with the conclusion, judgment, changed artifact, verification result, or named blocker.',
        'Final chat answers are usually 300-500 words unless the operator asked for comprehensive reference material, code, a long-form artifact, or exhaustive analysis.',
        'For broad multi-part questions, answer the decision first, collapse overlapping subquestions into one synthesis, and include only the facts that change the recommendation.',
        'When research or tool work was done, support the answer with 1-3 grounded findings and name the important sources, files, commands, checks, or artifacts.',
        'State only the missing facts, assumptions, risks, or unrun checks that affect the result.',
        'Use direct prose by default. Use only a few bullets when they are the shortest clear form; avoid headings, taxonomies, primers, inventories, and menus unless the operator asked for that shape.',
        '',
        'Execution protocol:',
        'Simple factual requests get direct answers. Current-world, source-dependent, provider, runtime, or software facts get search, URL fetch, file reads, logs, commands, or docs before answering.',
        'Work-shaped requests get proportional tool use: inspect, plan briefly when useful, execute, verify direct behavior, and report the result.',
        'Complex research, coding, artifact, or sustained analysis can be dispatched with deep_work from main threads when a dedicated work thread materially improves the outcome.',
        'If a required tool or source fails, try a distinct viable route; when no route remains, return a concise blocker report with what failed and what remains unverified.',
    ].join('\n')
}

function sharedPolicySection(config: PiRuntimeConfig): string {
    const githubInstruction = githubRepositoryInstruction(config)
    return [
        'Standing instructions and canonical memory are persistent context for this workspace.',
        'Treat workspace AGENTS.md, CLAUDE.md, and other project files as project-local files, not standing instructions.',
        attachmentHandlingInstruction(config),
        'Never read host-global Pi, Codex, provider, or credential files.',
        'Keep provider credentials, secrets, OAuth tokens, git credentials, and MCP authentication values out of responses, files, tool arguments, and logs.',
        'Use web search or URL fetch for current-world facts, docs lookup, prices, laws, provider details, API behavior, software versions, and other time-sensitive facts.',
        githubInstruction,
    ]
        .filter((line): line is string => line !== null)
        .join('\n')
}

function modeInstructions(config: PiRuntimeConfig): string {
    if (config.roomMode === 'programmer') {
        const lines = [
            'Programmer mode: inspect the repository, make the smallest correct change, run the relevant checks, and report the result plainly.',
            'Use shell, git, package managers, test runners, and editor tools directly when they are available in the workspace.',
            config.capabilities.images
                ? 'Prefer source changes and verification over explanatory artifacts; create image deliverables only when the operator explicitly asks.'
                : 'Prefer source changes and verification over explanatory artifacts.',
            'Update canonical memory for durable coding preferences, repository conventions, PR policy, current project context, or decisions.',
            'If you create a workspace notes file for bulky repository context, also store a concise canonical memory pointer to that file.',
        ]
        return lines.join('\n')
    }

    return [
        'Coworker mode: operate inside the provided workspace and durable artifact store.',
        'Create normal user-facing deliverables such as PDF, DOCX, XLSX, PPTX, images, or other durable artifacts when the request implies real-world output.',
        'Keep the workspace reviewable for non-developers: use scratch or intermediate files only when needed, name final deliverables clearly, and remove throwaway drafts, conversion sources, previews, logs, and temp files before finishing unless the operator asked to keep them.',
        'For document preview tools, omit outputPath unless the preview file itself is a requested deliverable; omitted previews are temporary internal verification only.',
        'Scheduled work is autonomous. If it cannot proceed, produce a clear failed result and any useful durable partial output.',
    ].join('\n')
}

function capabilityToolNames(config: PiRuntimeConfig): string[] {
    const browserAutomationEnabled =
        config.search.browserbase.enabled && Boolean(config.search.browserbase.envKey)
    return [
        config.capabilities.webSearch ? 'web_search' : null,
        config.capabilities.urlFetch ? 'fetch_url' : null,
        browserAutomationEnabled ? 'browser_open' : null,
        browserAutomationEnabled ? 'browser_close' : null,
        browserAutomationEnabled ? 'browser_navigate' : null,
        browserAutomationEnabled ? 'browser_click' : null,
        browserAutomationEnabled ? 'browser_type' : null,
        browserAutomationEnabled ? 'browser_scroll' : null,
        browserAutomationEnabled ? 'browser_screenshot' : null,
        browserAutomationEnabled ? 'browser_read_text' : null,
        config.capabilities.pdf ? 'read_pdf' : null,
        config.capabilities.pdf ? 'pdf' : null,
        config.capabilities.images ? 'image_generate' : null,
    ].filter((toolName): toolName is string => toolName !== null)
}

function enabledToolNames(config: PiRuntimeConfig): string[] {
    return [
        ...nativeWorkspaceToolNamesForCapabilities(config.capabilities),
        ...internalStateToolNames,
        ...roomToolNamesForCapabilities(config.roomMode, config.capabilities),
        ...capabilityToolNames(config),
    ]
}

export async function buildAgentRoomSystemPrompt(config: PiRuntimeConfig): Promise<string> {
    const budget = contextBudgetForProvider(config)
    const internalState = await buildInternalStateSummary(config)
    const memorySnapshot = await readMemory(config)
    const personality = sanitizePersonalityForm(memorySnapshot.memory.personality)
    const archetypeParagraph = resolveArchetypeParagraph(personality.archetype)
    const personalityControls = [
        'Personality controls:',
        ...personalityInstructionLines(personality).map((line) => `- ${line}`),
    ].join('\n')
    const operatorInstructions = boundedText(
        config.instructions.trim(),
        MAX_OPERATOR_INSTRUCTIONS_CHARS,
    )
    const browserAutomationEnabled =
        config.search.browserbase.enabled && Boolean(config.search.browserbase.envKey)
    const enabledTools = enabledToolNames(config)
    const enabledCapabilities = [
        config.capabilities.webSearch ? 'web search' : null,
        config.capabilities.urlFetch ? 'direct URL fetch' : null,
        browserAutomationEnabled ? 'Browserbase browser automation' : null,
        config.capabilities.documents ? 'DOCX documents' : null,
        config.capabilities.spreadsheets ? 'XLSX spreadsheets' : null,
        config.capabilities.presentations ? 'PPTX presentations' : null,
        config.capabilities.pdf ? 'native or rendered PDF reading, PDF export, and preview' : null,
        config.capabilities.images ? 'image generation' : null,
        config.capabilities.mcp ? 'connected MCP tools' : null,
        config.capabilities.shellCoding ? 'shell and coding tools' : null,
        config.github.enabled && config.github.repositories.length > 0
            ? 'GitHub repository access'
            : null,
    ].filter((capability): capability is string => capability !== null)
    const mcpTools = config.mcpServers.map((server) => {
        const tools =
            server.allowedTools.length > 0 ? server.allowedTools.join(', ') : 'all listed tools'
        return `${server.id}: ${tools}`
    })
    const now = new Date()

    const sections = [
        identitySection(config),
        archetypeParagraph,
        personalityControls,
        runtimeContextSection(config, budget, now),
        behaviorSection(),
        sharedPolicySection(config),
        artifactRoutingSection(config),
        modeInstructions(config),
        buildAgentHarnessPrompt(internalState),
        `Enabled capabilities: ${enabledCapabilities.join(', ') || 'none'}`,
        `Enabled tools: ${enabledTools.join(', ') || 'none'}`,
        `Main-thread orchestration tools: ${mainThreadOrchestrationToolNames.join(', ')}`,
        `Enabled MCP servers: ${mcpTools.join('; ') || 'none'}`,
    ]

    if (operatorInstructions.text) {
        sections.push(
            ['Operator instructions:', operatorInstructions.text].filter(Boolean).join('\n'),
        )
    }

    return boundedText(sections.join('\n\n'), budget.systemPromptMaxChars).text
}
