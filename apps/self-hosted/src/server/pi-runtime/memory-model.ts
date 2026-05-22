import { createHash, randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { z } from 'zod'
import { defaultPersonalityForm, personalityFormSchema } from '../rooms/personality/form'
import type { PiRuntimeConfig } from '../rooms/pi-runtime-config'

export const maxMemoryBytes = 64000
export const maxSectionItems = 40
export const lowPriorityTrimTarget = 28

const memoryItemSchema = z.strictObject({
    id: z.string().min(1),
    text: z.string().trim().min(1),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime().optional(),
    source: z.string().trim().min(1).optional(),
    priority: z.number().int().min(0).max(5).optional(),
    tags: z.array(z.string().trim().min(1)).optional(),
})

const timedMemoryItemSchema = memoryItemSchema.extend({
    dueAt: z.string().datetime().optional(),
    expiresAt: z.string().datetime().optional(),
    completedAt: z.string().datetime().optional(),
    recurrence: z
        .strictObject({
            rule: z.string().trim().min(1),
            timezone: z.string().trim().min(1).optional(),
        })
        .optional(),
})

export const roomMemorySchema = z.strictObject({
    version: z.literal(1),
    identity: z.strictObject({
        role: z.string(),
        responsibilities: z.array(memoryItemSchema),
        boundaries: z.array(memoryItemSchema),
    }),
    operator: z.strictObject({
        facts: z.array(memoryItemSchema),
        preferences: z.array(memoryItemSchema),
    }),
    behavior: z.strictObject({
        rules: z.array(memoryItemSchema),
        communication: z.array(memoryItemSchema),
    }),
    currentWork: z.strictObject({
        goals: z.array(memoryItemSchema),
        projects: z.array(memoryItemSchema),
        context: z.array(memoryItemSchema),
    }),
    schedule: z.strictObject({
        reminders: z.array(timedMemoryItemSchema),
        deadlines: z.array(timedMemoryItemSchema),
        recurring: z.array(timedMemoryItemSchema),
    }),
    decisions: z.array(memoryItemSchema),
    doNotForget: z.array(memoryItemSchema),
    personality: personalityFormSchema.optional(),
})

export type MemoryItem = z.infer<typeof memoryItemSchema>
export type TimedMemoryItem = z.infer<typeof timedMemoryItemSchema>
export type RoomMemory = z.infer<typeof roomMemorySchema>

export type MemorySectionPath =
    | 'identity.responsibilities'
    | 'identity.boundaries'
    | 'operator.facts'
    | 'operator.preferences'
    | 'behavior.rules'
    | 'behavior.communication'
    | 'currentWork.goals'
    | 'currentWork.projects'
    | 'currentWork.context'
    | 'schedule.reminders'
    | 'schedule.deadlines'
    | 'schedule.recurring'
    | 'decisions'
    | 'doNotForget'

export const memorySectionPaths: readonly MemorySectionPath[] = [
    'identity.responsibilities',
    'identity.boundaries',
    'operator.facts',
    'operator.preferences',
    'behavior.rules',
    'behavior.communication',
    'currentWork.goals',
    'currentWork.projects',
    'currentWork.context',
    'schedule.reminders',
    'schedule.deadlines',
    'schedule.recurring',
    'decisions',
    'doNotForget',
]

export const timedSections = new Set<MemorySectionPath>([
    'schedule.reminders',
    'schedule.deadlines',
    'schedule.recurring',
])

export interface MemorySnapshot {
    memory: RoomMemory
    path: string
    byteLength: number
    hash: string
    brief: string
}

export interface MemoryPatch {
    op: 'add' | 'update' | 'remove' | 'complete'
    section: MemorySectionPath
    id?: string
    text?: string
    source?: string
    priority?: number
    tags?: string[]
    dueAt?: string
    expiresAt?: string
    recurrence?: {
        rule: string
        timezone?: string
    }
}

export function isMemorySectionPath(value: string): value is MemorySectionPath {
    return (memorySectionPaths as readonly string[]).includes(value)
}

export function memoryPath(config: PiRuntimeConfig): string {
    return join(config.paths.internalStateDir, 'memory.json')
}

export function runLedgerPath(config: PiRuntimeConfig): string {
    return join(config.paths.internalStateDir, 'run-ledger')
}

export function nowIso(): string {
    return new Date().toISOString()
}

export function emptyRoomMemory(createdAt = nowIso()): RoomMemory {
    return {
        version: 1,
        identity: {
            role: 'Room-local coworker',
            responsibilities: [],
            boundaries: [],
        },
        operator: {
            facts: [],
            preferences: [],
        },
        behavior: {
            rules: [],
            communication: [],
        },
        currentWork: {
            goals: [],
            projects: [],
            context: [],
        },
        schedule: {
            reminders: [],
            deadlines: [],
            recurring: [],
        },
        decisions: [],
        doNotForget: [
            {
                id: randomUUID(),
                text: 'Keep durable memory concise and never store secrets or raw chat history',
                createdAt,
                source: 'system',
                priority: 5,
                tags: ['safety'],
            },
        ],
        personality: defaultPersonalityForm(),
    }
}

export function canonicalMemoryJson(memory: RoomMemory): string {
    return `${JSON.stringify(memory, null, 4)}\n`
}

export function hashRoomMemory(memory: RoomMemory): string {
    return createHash('sha256').update(canonicalMemoryJson(memory)).digest('hex')
}

export function sectionItems(
    memory: RoomMemory,
    section: MemorySectionPath,
): Array<MemoryItem | TimedMemoryItem> {
    if (section === 'identity.responsibilities') return memory.identity.responsibilities
    if (section === 'identity.boundaries') return memory.identity.boundaries
    if (section === 'operator.facts') return memory.operator.facts
    if (section === 'operator.preferences') return memory.operator.preferences
    if (section === 'behavior.rules') return memory.behavior.rules
    if (section === 'behavior.communication') return memory.behavior.communication
    if (section === 'currentWork.goals') return memory.currentWork.goals
    if (section === 'currentWork.projects') return memory.currentWork.projects
    if (section === 'currentWork.context') return memory.currentWork.context
    if (section === 'schedule.reminders') return memory.schedule.reminders
    if (section === 'schedule.deadlines') return memory.schedule.deadlines
    if (section === 'schedule.recurring') return memory.schedule.recurring
    if (section === 'decisions') return memory.decisions
    if (section === 'doNotForget') return memory.doNotForget
    throw new Error(`Unknown memory section ${section satisfies never}`)
}
