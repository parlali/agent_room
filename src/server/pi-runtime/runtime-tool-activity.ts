import type { SessionEntry } from '@mariozechner/pi-coding-agent'
import { categorizeAgentRoomTool } from '#/lib/agent-room-tool-categories'
import { isRecord } from './runtime-redaction'

export interface RunToolActivityCounts {
    totalToolCalls: number
    nonMemoryToolCalls: number
    researchCalls: number
    workspaceReadCalls: number
    workspaceWriteCalls: number
    commandCalls: number
    artifactCalls: number
    documentCalls: number
    imageCalls: number
    orchestrationCalls: number
    mcpCalls: number
    memoryReadCalls: number
    memoryWriteCalls: number
    otherToolCalls: number
}

function emptyToolActivityCounts(): RunToolActivityCounts {
    return {
        totalToolCalls: 0,
        nonMemoryToolCalls: 0,
        researchCalls: 0,
        workspaceReadCalls: 0,
        workspaceWriteCalls: 0,
        commandCalls: 0,
        artifactCalls: 0,
        documentCalls: 0,
        imageCalls: 0,
        orchestrationCalls: 0,
        mcpCalls: 0,
        memoryReadCalls: 0,
        memoryWriteCalls: 0,
        otherToolCalls: 0,
    }
}

function toolCallNamesFromEntry(entry: SessionEntry): string[] {
    if (entry.type !== 'message') {
        return []
    }
    const message = entry.message as unknown
    if (!isRecord(message) || !Array.isArray(message.content)) {
        return []
    }
    return message.content.flatMap((block) => {
        if (!isRecord(block) || block.type !== 'toolCall' || typeof block.name !== 'string') {
            return []
        }
        return [block.name]
    })
}

export function summarizeRunToolActivity(entries: readonly SessionEntry[]): RunToolActivityCounts {
    const counts = emptyToolActivityCounts()
    for (const entry of entries) {
        for (const toolName of toolCallNamesFromEntry(entry)) {
            counts.totalToolCalls += 1
            const category = categorizeAgentRoomTool(toolName)
            if (category === 'memory_read') {
                counts.memoryReadCalls += 1
                continue
            }
            if (category === 'memory_write') {
                counts.memoryWriteCalls += 1
                continue
            }
            counts.nonMemoryToolCalls += 1
            if (category === 'research_search' || category === 'research_fetch') {
                counts.researchCalls += 1
            } else if (category === 'workspace_read' || category === 'workspace_search') {
                counts.workspaceReadCalls += 1
            } else if (category === 'workspace_write') {
                counts.workspaceWriteCalls += 1
            } else if (category === 'command') {
                counts.commandCalls += 1
            } else if (category === 'artifact') {
                counts.artifactCalls += 1
            } else if (category === 'document_pdf') {
                counts.documentCalls += 1
            } else if (category === 'image') {
                counts.imageCalls += 1
            } else if (category === 'subagent' || category === 'deep_work') {
                counts.orchestrationCalls += 1
            } else if (category === 'mcp') {
                counts.mcpCalls += 1
            } else {
                counts.otherToolCalls += 1
            }
        }
    }
    return counts
}

export function memoryCaptureExpectationReasons(counts: RunToolActivityCounts): string[] {
    const reasons = new Set<string>()
    if (counts.researchCalls >= 2) {
        reasons.add('multiple_research_calls')
    }
    if (counts.workspaceReadCalls >= 2) {
        reasons.add('workspace_investigation')
    }
    if (counts.commandCalls > 0) {
        reasons.add('command_or_log_inspection')
    }
    if (counts.workspaceWriteCalls > 0) {
        reasons.add('workspace_changes')
    }
    if (counts.artifactCalls > 0) {
        reasons.add('artifact_work')
    }
    if (counts.documentCalls > 0) {
        reasons.add('document_work')
    }
    if (counts.imageCalls > 0) {
        reasons.add('image_work')
    }
    if (counts.orchestrationCalls > 0) {
        reasons.add('delegated_work')
    }
    if (counts.mcpCalls > 0) {
        reasons.add('connected_tool_work')
    }
    if (counts.nonMemoryToolCalls >= 3) {
        reasons.add('multi_tool_run')
    }
    return [...reasons]
}

export function memoryWasCaptured(input: {
    beforeHash: string | null
    afterHash: string | null
    counts: RunToolActivityCounts
}): boolean {
    if (input.beforeHash && input.afterHash) {
        return input.beforeHash !== input.afterHash
    }
    return input.counts.memoryWriteCalls > 0
}
