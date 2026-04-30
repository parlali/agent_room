import {
    defineTool,
    type AgentToolResult,
    type ToolDefinition,
} from '@mariozechner/pi-coding-agent'
import { Type } from '@mariozechner/pi-ai'
import type { PiRuntimeConfig } from '../rooms/pi-runtime-config'
import {
    isInternalStateDocumentKind,
    readInternalStateDocument,
    writeInternalStateDocument,
    type InternalStateDocumentKind,
} from './internal-state'

interface InternalStateToolDetails {
    document: InternalStateDocumentKind
    fileName: string
    byteLength: number
    maxBytes: number
    truncated: boolean
    sha256: string
}

interface InternalStateToolContext {
    config: PiRuntimeConfig
    audit: (event: string, payload: unknown) => Promise<void>
}

export const internalStateToolNames = [
    'agent_room_memory_read',
    'agent_room_memory_update',
] as const

function documentEnum() {
    return Type.String()
}

function normalizeDocument(value: unknown): InternalStateDocumentKind {
    if (typeof value === 'string') {
        const normalized = value.trim().replace(/\.md$/i, '')
        if (isInternalStateDocumentKind(normalized)) {
            return normalized
        }
    }
    throw new Error('Unknown internal state document')
}

function textResult(
    text: string,
    details: InternalStateToolDetails,
): AgentToolResult<InternalStateToolDetails> {
    return {
        content: [
            {
                type: 'text',
                text,
            },
        ],
        details,
    }
}

function detailsFromSnapshot(
    snapshot: Awaited<ReturnType<typeof readInternalStateDocument>>,
): InternalStateToolDetails {
    return {
        document: snapshot.kind,
        fileName: snapshot.fileName,
        byteLength: snapshot.byteLength,
        maxBytes: snapshot.maxBytes,
        truncated: snapshot.truncated,
        sha256: snapshot.sha256,
    }
}

export function createInternalStateTools(ctx: InternalStateToolContext): ToolDefinition[] {
    return [
        defineTool({
            name: 'agent_room_memory_read',
            label: 'Read Internal State',
            description:
                'Read one hidden internal Agent Room markdown document. Use document memory, plan, tasks, or decisions.',
            promptSnippet:
                'agent_room_memory_read reads bounded hidden internal docs that are not exposed in room files.',
            parameters: Type.Object({
                document: documentEnum(),
            }),
            execute: async (_toolCallId, input) => {
                const document = normalizeDocument(input.document)
                const snapshot = await readInternalStateDocument(ctx.config, document)
                await ctx.audit('tool.internal_state.read', detailsFromSnapshot(snapshot))
                return textResult(snapshot.content, detailsFromSnapshot(snapshot))
            },
        }),
        defineTool({
            name: 'agent_room_memory_update',
            label: 'Update Internal State',
            description:
                'Replace one hidden internal Agent Room markdown document while enforcing hard byte caps. Use document memory, plan, tasks, or decisions.',
            promptSnippet:
                'agent_room_memory_update replaces hidden internal docs. Keep them concise, structured, and free of raw chat history or secrets.',
            parameters: Type.Object({
                document: documentEnum(),
                content: Type.String(),
                expectedSha256: Type.Optional(Type.String()),
            }),
            execute: async (_toolCallId, input) => {
                const document = normalizeDocument(input.document)
                const snapshot = await writeInternalStateDocument({
                    config: ctx.config,
                    kind: document,
                    content: input.content,
                    expectedSha256:
                        typeof input.expectedSha256 === 'string' ? input.expectedSha256 : null,
                })
                await ctx.audit('tool.internal_state.update', detailsFromSnapshot(snapshot))
                return textResult(`Updated ${snapshot.fileName}`, detailsFromSnapshot(snapshot))
            },
        }),
    ]
}
