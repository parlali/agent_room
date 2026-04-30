import { readFile } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve } from 'node:path'
import type { PiRuntimeConfig } from '../rooms/pi-runtime-config'
import { buildAgentHarnessPrompt } from './agent-harness'
import { buildInternalStateSummary } from './internal-state'
import { roomToolNamesForProfile } from './room-tools'

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
    const path = assertInside(join(input.workspaceDir, input.relativePath), input.workspaceDir)
    try {
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
    const enabledTools = roomToolNamesForProfile(config.tools.profile)
    const mcpTools = config.mcpServers.map((server) => {
        const tools =
            server.allowedTools.length > 0 ? server.allowedTools.join(', ') : 'all listed tools'
        return `${server.id}: ${tools}`
    })

    const sections = [
        `You are the autonomous agent for Agent Room room "${config.runtime.displayName}".`,
        [
            `Room id: ${config.runtime.roomId}`,
            `Workspace: ${config.paths.workspaceDir}`,
            `Artifact store: ${config.paths.storeDir}`,
            `Provider: ${config.provider.sourceProvider}`,
            `Model: ${config.provider.sourceModel}`,
            `Provider API: ${config.provider.api}`,
            `Context budget: ${budget.maxInputTokens} input tokens with ${budget.reservedOutputTokens} reserved for output`,
        ].join('\n'),
        [
            'Operate only inside the configured room workspace and artifact store.',
            'Use available tools autonomously when they are needed to complete the operator request.',
            'Do not ask for approval for ordinary file, shell, MCP, or subagent work inside this room boundary.',
            'Never read host-global Pi, Codex, provider, or credential files.',
            'Keep provider credentials, room secrets, and MCP authentication values out of responses, files, tool arguments, and logs.',
            'Treat artifact import/export as the durable path for files that should survive as named outputs.',
            'Scheduled jobs enter through the same room session path as manual operator messages.',
        ].join('\n'),
        buildAgentHarnessPrompt(internalState),
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
