import { z } from 'zod'
import { personalityFormSchema } from '#/server/rooms/personality/form'

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

export function isMemorySectionPath(value: string): value is MemorySectionPath {
    return (memorySectionPaths as readonly string[]).includes(value)
}

export function nowIso(): string {
    return new Date().toISOString()
}

export function canonicalMemoryJson(memory: RoomMemory): string {
    return `${JSON.stringify(memory, null, 4)}\n`
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

export function setSectionItems(
    memory: RoomMemory,
    section: MemorySectionPath,
    items: Array<MemoryItem | TimedMemoryItem>,
): RoomMemory {
    if (section === 'identity.responsibilities') {
        return { ...memory, identity: { ...memory.identity, responsibilities: items } }
    }
    if (section === 'identity.boundaries') {
        return { ...memory, identity: { ...memory.identity, boundaries: items } }
    }
    if (section === 'operator.facts') {
        return { ...memory, operator: { ...memory.operator, facts: items } }
    }
    if (section === 'operator.preferences') {
        return { ...memory, operator: { ...memory.operator, preferences: items } }
    }
    if (section === 'behavior.rules') {
        return { ...memory, behavior: { ...memory.behavior, rules: items } }
    }
    if (section === 'behavior.communication') {
        return { ...memory, behavior: { ...memory.behavior, communication: items } }
    }
    if (section === 'currentWork.goals') {
        return { ...memory, currentWork: { ...memory.currentWork, goals: items } }
    }
    if (section === 'currentWork.projects') {
        return { ...memory, currentWork: { ...memory.currentWork, projects: items } }
    }
    if (section === 'currentWork.context') {
        return { ...memory, currentWork: { ...memory.currentWork, context: items } }
    }
    if (section === 'schedule.reminders') {
        return { ...memory, schedule: { ...memory.schedule, reminders: items } }
    }
    if (section === 'schedule.deadlines') {
        return { ...memory, schedule: { ...memory.schedule, deadlines: items } }
    }
    if (section === 'schedule.recurring') {
        return { ...memory, schedule: { ...memory.schedule, recurring: items } }
    }
    if (section === 'decisions') {
        return { ...memory, decisions: items }
    }
    if (section === 'doNotForget') {
        return { ...memory, doNotForget: items }
    }
    throw new Error(`Unknown memory section ${section satisfies never}`)
}

export interface MemorySectionMeta {
    path: MemorySectionPath
    title: string
    description: string
    placeholder: string
}

export interface MemoryGroupMeta {
    id: string
    title: string
    description: string
    sections: readonly MemorySectionMeta[]
}

export const memoryGroups: readonly MemoryGroupMeta[] = [
    {
        id: 'identity',
        title: 'Role and boundaries',
        description: 'What this room handles and where it should stop.',
        sections: [
            {
                path: 'identity.responsibilities',
                title: 'What this room handles',
                description: 'The work this room should take care of.',
                placeholder: 'Add something this room is responsible for...',
            },
            {
                path: 'identity.boundaries',
                title: 'What to avoid',
                description: 'Limits this room should respect.',
                placeholder: 'Add a limit this room should not cross...',
            },
        ],
    },
    {
        id: 'operator',
        title: 'About you',
        description: 'Stable facts and preferences about the person it works with.',
        sections: [
            {
                path: 'operator.facts',
                title: 'Facts about you',
                description: 'Stable facts worth remembering.',
                placeholder: 'Add a stable fact about you...',
            },
            {
                path: 'operator.preferences',
                title: 'How you like work handled',
                description: 'Preferences this room should follow.',
                placeholder: 'Add a preference to remember...',
            },
        ],
    },
    {
        id: 'behavior',
        title: 'Working style',
        description: 'Standing instructions and how this room should communicate.',
        sections: [
            {
                path: 'behavior.rules',
                title: 'Standing instructions',
                description: 'Rules this room should always follow.',
                placeholder: 'Add a standing instruction...',
            },
            {
                path: 'behavior.communication',
                title: 'How to communicate',
                description: 'How this room should keep in touch.',
                placeholder: 'Add a communication preference...',
            },
        ],
    },
    {
        id: 'currentWork',
        title: 'Current work',
        description: 'Goals, projects, and context that are active right now.',
        sections: [
            {
                path: 'currentWork.goals',
                title: 'Current goals',
                description: 'Outcomes in progress.',
                placeholder: 'Add a current goal...',
            },
            {
                path: 'currentWork.projects',
                title: 'Active projects',
                description: 'Project context this room is working in.',
                placeholder: 'Add project context...',
            },
            {
                path: 'currentWork.context',
                title: 'Working context',
                description: 'Short-lived context that still matters.',
                placeholder: 'Add current context...',
            },
        ],
    },
    {
        id: 'schedule',
        title: 'Schedule',
        description: 'Reminders, deadlines, and recurring routines with their dates.',
        sections: [
            {
                path: 'schedule.reminders',
                title: 'Reminders',
                description: 'Things to bring back at the right time.',
                placeholder: 'Add a reminder...',
            },
            {
                path: 'schedule.deadlines',
                title: 'Deadlines',
                description: 'Time-bound commitments.',
                placeholder: 'Add a deadline...',
            },
            {
                path: 'schedule.recurring',
                title: 'Recurring routines',
                description: 'Repeated work on a schedule.',
                placeholder: 'Add a recurring routine...',
            },
        ],
    },
    {
        id: 'decisions',
        title: 'Settled decisions',
        description: 'Decisions that should not need to be re-made.',
        sections: [
            {
                path: 'decisions',
                title: 'Settled decisions',
                description: 'Conclusions to keep.',
                placeholder: 'Add a decision...',
            },
        ],
    },
    {
        id: 'doNotForget',
        title: 'Do not forget',
        description: 'Important memory that should always stay visible.',
        sections: [
            {
                path: 'doNotForget',
                title: 'Always keep in mind',
                description: 'High-priority memory.',
                placeholder: 'Add something important...',
            },
        ],
    },
]
