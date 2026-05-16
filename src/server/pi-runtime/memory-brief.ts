import type { MemoryItem, RoomMemory } from './memory-model'
import { boundTextByChars } from './bounded-text'

const maxBriefChars = 12000

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
    return boundTextByChars(text, maxBriefChars).text
}
