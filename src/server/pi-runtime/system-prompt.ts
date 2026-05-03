import { readFile, realpath } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve } from 'node:path'
import type { PiRuntimeConfig } from '../rooms/pi-runtime-config'
import { buildAgentHarnessPrompt } from './agent-harness'
import { buildInternalStateSummary } from './internal-state'
import { roomToolNamesForCapabilities } from './room-tools'

interface LoadedInstructionFile {
    path: string
    text: string
    truncated: boolean
}

export interface ContextBudget {
    maxInputTokens: number
    reservedOutputTokens: number
    systemPromptMaxChars: number
}

const MAX_INSTRUCTION_FILE_BYTES = 32000
const MAX_OPERATOR_INSTRUCTIONS_CHARS = 24000

function assertInside(candidate: string, root: string): string {
    const normalizedRoot = resolve(root)
    const normalizedCandidate = resolve(candidate)
    const diff = relative(normalizedRoot, normalizedCandidate)
    if (diff === '' || (!diff.startsWith('..') && !isAbsolute(diff))) {
        return normalizedCandidate
    }
    throw new Error(`Instruction file escapes room workspace: ${candidate}`)
}

function boundedText(
    input: string,
    maxChars: number,
): {
    text: string
    truncated: boolean
} {
    if (input.length <= maxChars) {
        return {
            text: input,
            truncated: false,
        }
    }
    return {
        text: input.slice(0, maxChars),
        truncated: true,
    }
}

async function readBoundedInstructionFile(input: {
    workspaceDir: string
    relativePath: string
    roomInstructions: string
}): Promise<LoadedInstructionFile | null> {
    try {
        const workspace = await realpath(input.workspaceDir)
        const requested = assertInside(join(workspace, input.relativePath), workspace)
        const path = assertInside(await realpath(requested), workspace)
        const raw = await readFile(path, {
            encoding: 'utf8',
        })
        const bounded = boundedText(raw, MAX_INSTRUCTION_FILE_BYTES)
        const text = bounded.text.trim()
        if (!text || text === input.roomInstructions.trim()) {
            return null
        }
        return {
            path: input.relativePath,
            text,
            truncated: bounded.truncated,
        }
    } catch {
        return null
    }
}

export function contextBudgetForProvider(config: PiRuntimeConfig): ContextBudget {
    const provider = config.provider.sourceProvider.toLowerCase()
    const api = config.provider.api
    const maxInputTokens =
        provider === 'ollama' || provider === 'lmstudio'
            ? 32768
            : api === 'google-generative-ai'
              ? 100000
              : 128000
    const reservedOutputTokens = Math.min(16384, Math.max(4096, Math.floor(maxInputTokens * 0.15)))
    return {
        maxInputTokens,
        reservedOutputTokens,
        systemPromptMaxChars: Math.min(48000, Math.floor(maxInputTokens * 0.6)),
    }
}

export async function loadInstructionFiles(
    config: PiRuntimeConfig,
): Promise<LoadedInstructionFile[]> {
    const candidates = ['AGENTS.md', '.agents/AGENTS.md']
    const files = await Promise.all(
        candidates.map((relativePath) =>
            readBoundedInstructionFile({
                workspaceDir: config.paths.workspaceDir,
                relativePath,
                roomInstructions: config.instructions,
            }),
        ),
    )
    return files.filter((file): file is LoadedInstructionFile => file !== null)
}

export async function buildAgentRoomSystemPrompt(config: PiRuntimeConfig): Promise<string> {
    const budget = contextBudgetForProvider(config)
    const instructionFiles = await loadInstructionFiles(config)
    const internalState = await buildInternalStateSummary(config)
    const operatorInstructions = boundedText(
        config.instructions.trim(),
        MAX_OPERATOR_INSTRUCTIONS_CHARS,
    )
    const enabledTools = roomToolNamesForCapabilities(config.tools.profile, config.capabilities)
    const enabledCapabilities = [
        config.capabilities.webSearch ? 'web search' : null,
        config.capabilities.urlFetch ? 'direct URL fetch' : null,
        config.capabilities.documents ? 'DOCX documents' : null,
        config.capabilities.spreadsheets ? 'XLSX spreadsheets' : null,
        config.capabilities.presentations ? 'PPTX presentations' : null,
        config.capabilities.pdf ? 'PDF export and preview' : null,
        config.capabilities.images ? 'image generation' : null,
        config.capabilities.mcp ? 'connected MCP tools' : null,
        config.capabilities.shellCoding ? 'shell and coding tools' : null,
    ].filter((capability): capability is string => capability !== null)
    const mcpTools = config.mcpServers.map((server) => {
        const tools =
            server.allowedTools.length > 0 ? server.allowedTools.join(', ') : 'all listed tools'
        return `${server.id}: ${tools}`
    })
    const now = new Date()

    const sections = [
        `You are ${config.runtime.displayName}, a persistent room-local coworker.`,
        [
            `Current datetime: ${now.toISOString()}`,
            `Timezone: ${Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'}`,
            `Provider: ${config.provider.sourceProvider}`,
            `Model: ${config.provider.sourceModel}`,
            `Context budget: ${budget.maxInputTokens} input tokens with ${budget.reservedOutputTokens} reserved for output`,
        ].join('\n'),
        [
            'Own the requested work end to end: understand, inspect, plan when the task is non-trivial, execute, verify direct behavior, update durable memory when needed, then report the result concisely.',
            'Use available tools autonomously when they are needed to complete the operator request.',
            'Ask for help only when authentication, missing credentials, destructive external actions, or unavailable user data block progress.',
            'Operate inside the provided workspace and durable artifact store.',
            'Never read host-global Pi, Codex, provider, or credential files.',
            'Keep provider credentials, room secrets, and MCP authentication values out of responses, files, tool arguments, and logs.',
            'Use web search for current-world facts, docs lookup, prices, laws, provider details, software versions, and other time-sensitive facts.',
            'Prefer normal user-facing deliverables: PDF, DOCX, XLSX, PPTX, images, or other durable artifacts when the request implies real-world output.',
            'Scheduled work is autonomous. If it cannot proceed, produce a clear failed result and any useful durable partial output.',
            'Final responses should be concise, artifact-aware, and honest about verification.',
        ].join('\n'),
        buildAgentHarnessPrompt(internalState),
        `Enabled capabilities: ${enabledCapabilities.join(', ') || 'none'}`,
        `Enabled built-in tools: ${enabledTools.join(', ') || 'none'}`,
        `Enabled MCP servers: ${mcpTools.join('; ') || 'none'}`,
    ]

    if (operatorInstructions.text) {
        sections.push(
            [
                'Operator instructions:',
                operatorInstructions.text,
                operatorInstructions.truncated ? '[truncated]' : '',
            ]
                .filter(Boolean)
                .join('\n'),
        )
    }

    for (const file of instructionFiles) {
        sections.push(
            [`Instruction file ${file.path}:`, file.text, file.truncated ? '[truncated]' : '']
                .filter(Boolean)
                .join('\n'),
        )
    }

    return boundedText(sections.join('\n\n'), budget.systemPromptMaxChars).text
}
