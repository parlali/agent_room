import { randomUUID } from 'node:crypto'
import {
    nowIso,
    sectionItems,
    timedSections,
    type MemoryItem,
    type MemoryPatch,
    type RoomMemory,
    type TimedMemoryItem,
} from './memory-model'

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

export function applyMemoryPatch(memory: RoomMemory, patch: MemoryPatch): void {
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
