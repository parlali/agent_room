import {
    defineTool,
    type AgentToolResult,
    type ToolDefinition,
} from '@mariozechner/pi-coding-agent'
import { Type } from '@mariozechner/pi-ai'
import type { PiRuntimeConfig } from '../rooms/pi-runtime-config'
import {
    isMemorySectionPath,
    patchMemory,
    readMemory,
    replaceMemory,
    type MemoryPatch,
} from './memory'

interface MemoryToolDetails {
    path: string
    byteLength: number
    hash: string
}

interface InternalStateToolContext {
    config: PiRuntimeConfig
    audit: (event: string, payload: unknown) => Promise<void>
}

export const internalStateToolNames = [
    'agent_room_memory_read',
    'agent_room_memory_replace',
    'agent_room_memory_patch',
] as const

function textResult(text: string, details: MemoryToolDetails): AgentToolResult<MemoryToolDetails> {
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

function snapshotDetails(snapshot: Awaited<ReturnType<typeof readMemory>>): MemoryToolDetails {
    return {
        path: snapshot.path,
        byteLength: snapshot.byteLength,
        hash: snapshot.hash,
    }
}

function normalizePatch(value: unknown): MemoryPatch {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error('Memory patch must be an object')
    }
    const record = value as Record<string, unknown>
    const op = record.op
    const section = record.section
    if (op !== 'add' && op !== 'update' && op !== 'remove' && op !== 'complete') {
        throw new Error('Memory patch op must be add, update, remove, or complete')
    }
    if (typeof section !== 'string' || !isMemorySectionPath(section)) {
        throw new Error('Memory patch section must be a canonical memory section')
    }
    return {
        op,
        section: section as MemoryPatch['section'],
        id: typeof record.id === 'string' ? record.id : undefined,
        text: typeof record.text === 'string' ? record.text : undefined,
        source: typeof record.source === 'string' ? record.source : undefined,
        priority: typeof record.priority === 'number' ? record.priority : undefined,
        tags: Array.isArray(record.tags)
            ? record.tags.filter((tag): tag is string => typeof tag === 'string')
            : undefined,
        dueAt: typeof record.dueAt === 'string' ? record.dueAt : undefined,
        expiresAt: typeof record.expiresAt === 'string' ? record.expiresAt : undefined,
        recurrence:
            record.recurrence && typeof record.recurrence === 'object'
                ? (record.recurrence as MemoryPatch['recurrence'])
                : undefined,
    }
}

export function createInternalStateTools(ctx: InternalStateToolContext): ToolDefinition[] {
    return [
        defineTool({
            name: 'agent_room_memory_read',
            label: 'Read Room Memory',
            description:
                'Read canonical JSON room memory and its deterministic prompt brief with a revision hash.',
            promptSnippet:
                'agent_room_memory_read reads the room-local canonical memory JSON and brief.',
            parameters: Type.Object({}),
            execute: async () => {
                const snapshot = await readMemory(ctx.config)
                await ctx.audit('tool.memory.read', {
                    path: snapshot.path,
                    byteLength: snapshot.byteLength,
                    hash: snapshot.hash,
                })
                return textResult(
                    JSON.stringify(
                        {
                            hash: snapshot.hash,
                            brief: snapshot.brief,
                            memory: snapshot.memory,
                        },
                        null,
                        4,
                    ),
                    snapshotDetails(snapshot),
                )
            },
        }),
        defineTool({
            name: 'agent_room_memory_replace',
            label: 'Replace Room Memory',
            description:
                'Replace canonical room memory JSON after reading the current hash. Never store secrets or raw chat history.',
            promptSnippet:
                'agent_room_memory_replace replaces the whole room-local memory JSON using optimistic concurrency.',
            parameters: Type.Object({
                memoryJson: Type.String(),
                expectedHash: Type.Optional(Type.String()),
            }),
            execute: async (_toolCallId, input) => {
                const memory = JSON.parse(input.memoryJson)
                const snapshot = await replaceMemory({
                    config: ctx.config,
                    memory,
                    expectedHash:
                        typeof input.expectedHash === 'string' ? input.expectedHash : null,
                })
                await ctx.audit('tool.memory.replace', {
                    path: snapshot.path,
                    byteLength: snapshot.byteLength,
                    hash: snapshot.hash,
                })
                return textResult(
                    JSON.stringify(
                        {
                            hash: snapshot.hash,
                            brief: snapshot.brief,
                        },
                        null,
                        4,
                    ),
                    snapshotDetails(snapshot),
                )
            },
        }),
        defineTool({
            name: 'agent_room_memory_patch',
            label: 'Patch Room Memory',
            description:
                'Apply typed add, update, remove, or complete operations to canonical room memory.',
            promptSnippet:
                'agent_room_memory_patch updates room memory sections with typed operations and expectedHash.',
            parameters: Type.Object({
                patches: Type.Array(
                    Type.Object({
                        op: Type.Union([
                            Type.Literal('add'),
                            Type.Literal('update'),
                            Type.Literal('remove'),
                            Type.Literal('complete'),
                        ]),
                        section: Type.String(),
                        id: Type.Optional(Type.String()),
                        text: Type.Optional(Type.String()),
                        source: Type.Optional(Type.String()),
                        priority: Type.Optional(Type.Number()),
                        tags: Type.Optional(Type.Array(Type.String())),
                        dueAt: Type.Optional(Type.String()),
                        expiresAt: Type.Optional(Type.String()),
                        recurrence: Type.Optional(
                            Type.Object({
                                rule: Type.String(),
                                timezone: Type.Optional(Type.String()),
                            }),
                        ),
                    }),
                ),
                expectedHash: Type.Optional(Type.String()),
            }),
            execute: async (_toolCallId, input) => {
                if (!Array.isArray(input.patches)) {
                    throw new Error('patches must be an array')
                }
                const snapshot = await patchMemory({
                    config: ctx.config,
                    patches: input.patches.map(normalizePatch),
                    expectedHash:
                        typeof input.expectedHash === 'string' ? input.expectedHash : null,
                })
                await ctx.audit('tool.memory.patch', {
                    path: snapshot.path,
                    byteLength: snapshot.byteLength,
                    hash: snapshot.hash,
                    patchCount: input.patches.length,
                })
                return textResult(
                    JSON.stringify(
                        {
                            hash: snapshot.hash,
                            brief: snapshot.brief,
                        },
                        null,
                        4,
                    ),
                    snapshotDetails(snapshot),
                )
            },
        }),
    ]
}
