import { createHash, randomUUID } from 'node:crypto'
import { constants as fsConstants } from 'node:fs'
import { access, chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { z } from 'zod'
import type { PiRuntimeConfig } from '../rooms/pi-runtime-config'

const maxMemoryBytes = 64000
const maxBriefChars = 12000
const maxSectionItems = 40
const lowPriorityTrimTarget = 28

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

export function isMemorySectionPath(value: string): value is MemorySectionPath {
    return (memorySectionPaths as readonly string[]).includes(value)
}

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

const timedSections = new Set<MemorySectionPath>([
    'schedule.reminders',
    'schedule.deadlines',
    'schedule.recurring',
])

export function memoryPath(config: PiRuntimeConfig): string {
    return join(config.paths.internalStateDir, 'memory.json')
}

export function runLedgerPath(config: PiRuntimeConfig): string {
    return join(config.paths.internalStateDir, 'run-ledger')
}

function nowIso(): string {
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
    }
}

function hashText(value: string): string {
    return createHash('sha256').update(value).digest('hex')
}

function canonicalMemoryJson(memory: RoomMemory): string {
    return `${JSON.stringify(memory, null, 4)}\n`
}

function snapshotHash(memory: RoomMemory): string {
    return hashText(canonicalMemoryJson(memory))
}

export function hashRoomMemory(memory: RoomMemory): string {
    return snapshotHash(memory)
}

async function exists(path: string): Promise<boolean> {
    try {
        await access(path, fsConstants.F_OK)
        return true
    } catch {
        return false
    }
}

async function writeJsonAtomically(path: string, value: RoomMemory): Promise<void> {
    const json = canonicalMemoryJson(value)
    const byteLength = Buffer.byteLength(json)
    if (byteLength > maxMemoryBytes) {
        throw new Error(`memory.json is ${byteLength} bytes; hard cap is ${maxMemoryBytes} bytes`)
    }
    await mkdir(dirname(path), {
        recursive: true,
        mode: 0o700,
    })
    const tempPath = `${path}.${process.pid}.${Date.now()}.${randomUUID()}.tmp`
    await writeFile(tempPath, json, {
        encoding: 'utf8',
        mode: 0o600,
    })
    await rename(tempPath, path)
    await chmod(path, 0o600)
}

function itemFromText(text: string, source: string, priority = 3): MemoryItem {
    return {
        id: randomUUID(),
        text: text.trim(),
        createdAt: nowIso(),
        source,
        priority,
    }
}

function markdownLinesToItems(markdown: string, source: string): MemoryItem[] {
    return markdown
        .split(/\r?\n/)
        .map((line) =>
            line
                .replace(/^[-*]\s+\[[ x]\]\s+/i, '')
                .replace(/^[-*]\s+/, '')
                .trim(),
        )
        .filter((line) => line && !line.startsWith('#'))
        .slice(0, 20)
        .map((line) => itemFromText(line, source))
}

async function migrateLegacyMarkdown(config: PiRuntimeConfig): Promise<RoomMemory> {
    const memory = emptyRoomMemory()
    const legacy = [
        {
            file: 'memory.md',
            section: 'doNotForget' as const,
            source: 'legacy-memory',
        },
        {
            file: 'plan.md',
            section: 'currentWork.context' as const,
            source: 'legacy-plan',
        },
        {
            file: 'tasks.md',
            section: 'currentWork.goals' as const,
            source: 'legacy-tasks',
        },
        {
            file: 'decisions.md',
            section: 'decisions' as const,
            source: 'legacy-decisions',
        },
    ]

    for (const entry of legacy) {
        const path = join(config.paths.internalStateDir, entry.file)
        if (!(await exists(path))) {
            continue
        }
        const items = markdownLinesToItems(await readFile(path, 'utf8'), entry.source)
        const target = sectionItems(memory, entry.section)
        target.push(...items)
    }

    return maintainMemory(memory).memory
}

export async function ensureMemory(config: PiRuntimeConfig): Promise<MemorySnapshot> {
    await mkdir(config.paths.internalStateDir, {
        recursive: true,
        mode: 0o700,
    })
    await mkdir(runLedgerPath(config), {
        recursive: true,
        mode: 0o700,
    })
    const path = memoryPath(config)
    if (!(await exists(path))) {
        await writeJsonAtomically(path, await migrateLegacyMarkdown(config))
    }
    return readMemory(config)
}

export async function readMemory(config: PiRuntimeConfig): Promise<MemorySnapshot> {
    const path = memoryPath(config)
    const raw = await readFile(path, 'utf8')
    const parsed = roomMemorySchema.safeParse(JSON.parse(raw))
    if (!parsed.success) {
        throw new Error(`memory.json failed schema validation: ${parsed.error.message}`)
    }
    const maintained = maintainMemory(parsed.data)
    if (maintained.changed) {
        await writeJsonAtomically(path, maintained.memory)
    }
    const memory = maintained.memory
    const json = canonicalMemoryJson(memory)
    return {
        memory,
        path,
        byteLength: Buffer.byteLength(json),
        hash: snapshotHash(memory),
        brief: renderMemoryBrief(memory),
    }
}

export async function replaceMemory(input: {
    config: PiRuntimeConfig
    memory: unknown
    expectedHash?: string | null
}): Promise<MemorySnapshot> {
    const previous = await ensureMemory(input.config)
    if (input.expectedHash && previous.hash !== input.expectedHash) {
        throw new Error('memory.json changed before update; read it again')
    }
    const parsed = roomMemorySchema.safeParse(input.memory)
    if (!parsed.success) {
        throw new Error(`memory.json failed schema validation: ${parsed.error.message}`)
    }
    const maintained = maintainMemory(parsed.data).memory
    await writeJsonAtomically(memoryPath(input.config), maintained)
    return readMemory(input.config)
}

function sectionItems(
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

function buildPatchItem(patch: MemoryPatch): MemoryItem | TimedMemoryItem {
    if (!patch.text?.trim()) {
        throw new Error('Memory add patch requires text')
    }
    const base: MemoryItem = {
        id: patch.id ?? randomUUID(),
        text: patch.text.trim(),
        createdAt: nowIso(),
        ...(patch.source ? { source: patch.source } : {}),
        ...(typeof patch.priority === 'number' ? { priority: patch.priority } : {}),
        ...(patch.tags ? { tags: patch.tags } : {}),
    }
    if (!timedSections.has(patch.section)) {
        return base
    }
    return {
        ...base,
        ...(patch.dueAt ? { dueAt: patch.dueAt } : {}),
        ...(patch.expiresAt ? { expiresAt: patch.expiresAt } : {}),
        ...(patch.recurrence ? { recurrence: patch.recurrence } : {}),
    }
}

function applyOnePatch(memory: RoomMemory, patch: MemoryPatch): void {
    const items = sectionItems(memory, patch.section)
    if (patch.op === 'add') {
        items.push(buildPatchItem(patch))
        return
    }

    if (!patch.id) {
        throw new Error(`${patch.op} memory patch requires id`)
    }
    const index = items.findIndex((item) => item.id === patch.id)
    if (index === -1) {
        throw new Error(`Memory item ${patch.id} was not found in ${patch.section}`)
    }
    if (patch.op === 'remove') {
        items.splice(index, 1)
        return
    }
    const existing = items[index]!
    if (patch.op === 'complete') {
        if (!timedSections.has(patch.section)) {
            throw new Error('Only timed memory items can be completed')
        }
        items[index] = {
            ...existing,
            completedAt: nowIso(),
            updatedAt: nowIso(),
        } as TimedMemoryItem
        return
    }
    items[index] = {
        ...existing,
        ...(patch.text ? { text: patch.text.trim() } : {}),
        ...(patch.source ? { source: patch.source } : {}),
        ...(typeof patch.priority === 'number' ? { priority: patch.priority } : {}),
        ...(patch.tags ? { tags: patch.tags } : {}),
        ...(patch.dueAt ? { dueAt: patch.dueAt } : {}),
        ...(patch.expiresAt ? { expiresAt: patch.expiresAt } : {}),
        ...(patch.recurrence ? { recurrence: patch.recurrence } : {}),
        updatedAt: nowIso(),
    }
}

export async function patchMemory(input: {
    config: PiRuntimeConfig
    patches: MemoryPatch[]
    expectedHash?: string | null
}): Promise<MemorySnapshot> {
    const snapshot = await ensureMemory(input.config)
    if (input.expectedHash && snapshot.hash !== input.expectedHash) {
        throw new Error('memory.json changed before update; read it again')
    }
    const memory = structuredClone(snapshot.memory)
    for (const patch of input.patches) {
        applyOnePatch(memory, patch)
    }
    const maintained = maintainMemory(memory).memory
    const parsed = roomMemorySchema.safeParse(maintained)
    if (!parsed.success) {
        throw new Error(`memory.json failed schema validation: ${parsed.error.message}`)
    }
    await writeJsonAtomically(memoryPath(input.config), parsed.data)
    return readMemory(input.config)
}

function parseTime(value: string | undefined): number | null {
    if (!value) {
        return null
    }
    const parsed = Date.parse(value)
    return Number.isFinite(parsed) ? parsed : null
}

function normalizeItems<T extends MemoryItem>(items: T[]): T[] {
    const seen = new Set<string>()
    return items
        .filter((item) => {
            if (!item.text.trim() || seen.has(item.id)) {
                return false
            }
            seen.add(item.id)
            return true
        })
        .map((item) => ({
            ...item,
            text: item.text.trim(),
            tags: item.tags?.map((tag) => tag.trim()).filter(Boolean),
        }))
        .sort((left, right) => {
            const priorityDelta = (right.priority ?? 3) - (left.priority ?? 3)
            if (priorityDelta !== 0) {
                return priorityDelta
            }
            return (
                Date.parse(right.updatedAt ?? right.createdAt) -
                Date.parse(left.updatedAt ?? left.createdAt)
            )
        })
        .slice(0, maxSectionItems)
}

function normalizeTimedItems(items: TimedMemoryItem[], now: number): TimedMemoryItem[] {
    return normalizeItems(items)
        .filter((item) => {
            const expiresAt = parseTime(item.expiresAt)
            return expiresAt === null || expiresAt > now || item.completedAt
        })
        .map((item) => {
            const dueAt = parseTime(item.dueAt)
            if (
                dueAt !== null &&
                dueAt < now &&
                !item.completedAt &&
                !item.recurrence &&
                !item.tags?.includes('stale')
            ) {
                return {
                    ...item,
                    tags: Array.from(new Set([...(item.tags ?? []), 'stale'])),
                    updatedAt: nowIso(),
                }
            }
            return item
        })
}

function trimLowPriority(items: MemoryItem[]): MemoryItem[] {
    if (items.length <= maxSectionItems) {
        return items
    }
    const high = items.filter((item) => (item.priority ?? 3) >= 3)
    if (high.length >= lowPriorityTrimTarget) {
        return high.slice(0, maxSectionItems)
    }
    return items.slice(0, maxSectionItems)
}

export function maintainMemory(memory: RoomMemory): { memory: RoomMemory; changed: boolean } {
    const before = canonicalMemoryJson(memory)
    const now = Date.now()
    const next: RoomMemory = {
        ...memory,
        identity: {
            role: memory.identity.role.trim() || 'Room-local coworker',
            responsibilities: trimLowPriority(normalizeItems(memory.identity.responsibilities)),
            boundaries: trimLowPriority(normalizeItems(memory.identity.boundaries)),
        },
        operator: {
            facts: trimLowPriority(normalizeItems(memory.operator.facts)),
            preferences: trimLowPriority(normalizeItems(memory.operator.preferences)),
        },
        behavior: {
            rules: trimLowPriority(normalizeItems(memory.behavior.rules)),
            communication: trimLowPriority(normalizeItems(memory.behavior.communication)),
        },
        currentWork: {
            goals: trimLowPriority(normalizeItems(memory.currentWork.goals)),
            projects: trimLowPriority(normalizeItems(memory.currentWork.projects)),
            context: trimLowPriority(normalizeItems(memory.currentWork.context)),
        },
        schedule: {
            reminders: normalizeTimedItems(memory.schedule.reminders, now),
            deadlines: normalizeTimedItems(memory.schedule.deadlines, now),
            recurring: normalizeTimedItems(memory.schedule.recurring, now),
        },
        decisions: trimLowPriority(normalizeItems(memory.decisions)),
        doNotForget: trimLowPriority(normalizeItems(memory.doNotForget)),
    }
    return {
        memory: next,
        changed: canonicalMemoryJson(next) !== before,
    }
}

function sectionLines(title: string, items: MemoryItem[]): string[] {
    if (items.length === 0) {
        return []
    }
    return [
        title,
        ...items.slice(0, 12).map((item) => {
            const due =
                'dueAt' in item && typeof item.dueAt === 'string' ? ` due ${item.dueAt}` : ''
            const tags = item.tags?.length ? ` [${item.tags.join(', ')}]` : ''
            return `- ${item.text}${due}${tags}`
        }),
    ]
}

export function renderMemoryBrief(memory: RoomMemory): string {
    const lines = [
        `Room memory brief, version ${memory.version}`,
        `Identity: ${memory.identity.role}`,
        ...sectionLines('Responsibilities', memory.identity.responsibilities),
        ...sectionLines('Boundaries', memory.identity.boundaries),
        ...sectionLines('Operator facts', memory.operator.facts),
        ...sectionLines('Operator preferences', memory.operator.preferences),
        ...sectionLines('Behavior rules', memory.behavior.rules),
        ...sectionLines('Communication preferences', memory.behavior.communication),
        ...sectionLines('Current goals', memory.currentWork.goals),
        ...sectionLines('Projects', memory.currentWork.projects),
        ...sectionLines('Context', memory.currentWork.context),
        ...sectionLines('Reminders', memory.schedule.reminders),
        ...sectionLines('Deadlines', memory.schedule.deadlines),
        ...sectionLines('Recurring schedule', memory.schedule.recurring),
        ...sectionLines('Decisions', memory.decisions),
        ...sectionLines('Do not forget', memory.doNotForget),
    ].filter(Boolean)
    const text = lines.join('\n')
    return text.length <= maxBriefChars ? text : `${text.slice(0, maxBriefChars)}\n[truncated]`
}
