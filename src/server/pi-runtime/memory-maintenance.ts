import {
    canonicalMemoryJson,
    lowPriorityTrimTarget,
    maxSectionItems,
    nowIso,
    type MemoryItem,
    type RoomMemory,
    type TimedMemoryItem,
} from './memory-model'

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
