import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createTestPiRuntimeConfig } from './test-runtime-defaults'
import { createPiRuntimeCustomTools, type PiRuntimeSessionInput } from './pi-runtime-session'
import { BrowserbaseBrowserAutomationManager } from './browserbase-browser'
import type { ThreadRecord } from './thread-records'

function threadRecord(input: { key: string; kind?: ThreadRecord['kind'] }): ThreadRecord {
    const now = Date.now()
    return {
        key: input.key,
        sessionFile: join(tmpdir(), `${input.key}.jsonl`),
        sessionId: input.key,
        title: 'Conversation',
        titleSource: 'initial',
        status: 'idle',
        createdAt: now,
        updatedAt: now,
        lastMessagePreview: null,
        modelProvider: 'ollama',
        model: 'llama',
        thinkingLevel: 'medium',
        activeRunId: null,
        activeRunKind: null,
        heartbeatAt: null,
        runStartedAt: null,
        runBudgetExpiresAt: null,
        idleTimeoutExpiresAt: null,
        activeDurationMs: 0,
        idleDurationMs: 0,
        lastError: null,
        kind: input.kind ?? 'main',
        parentThreadKey: null,
        parentRunId: null,
        subagentRunId: null,
        subagentName: null,
        subagentTask: null,
        deepWorkRunId: null,
        deepWorkObjective: null,
        completedAt: null,
    }
}

async function withToolInput<T>(
    roomMode: PiRuntimeSessionInput['config']['roomMode'],
    fn: (input: PiRuntimeSessionInput) => T | Promise<T>,
    kind: ThreadRecord['kind'] = 'main',
): Promise<T> {
    const root = await mkdtemp(join(tmpdir(), 'agent-room-runtime-tools-'))
    const config = createTestPiRuntimeConfig({
        root,
        roomMode,
        capabilities: {
            documents: false,
            spreadsheets: false,
            presentations: false,
            pdf: false,
            images: false,
            mcp: false,
        },
    })
    const browserAutomation = new BrowserbaseBrowserAutomationManager({
        config,
        audit: async () => {},
        broadcast: () => {},
    })
    const record = threadRecord({ key: `${roomMode}-thread`, kind })
    try {
        return await fn({
            config,
            record,
            systemPrompt: () => '',
            mcpTools: [],
            browserAutomation,
            audit: async () => {},
            shortText: (value) => value,
            redactString: (value) => value,
            redactCommandOutput: (value) => value,
            maxSubagentTaskChars: 24000,
            maxActiveSubagents: 5,
            activeSubagentCount: () => 0,
            maxDeepWorkObjectiveChars: 48000,
            maxDeepWorkResultChars: 60000,
            maxActiveDeepWork: 2,
            activeDeepWorkCount: () => 0,
            reserveDeepWorkSlot: () => () => {},
            readMemoryBrief: async () => '',
            createThread: async () => ({ key: 'created-thread' }),
            findThread: () => null,
            runPrompt: async () => 'idle',
            readThreadMessages: () => [],
            persistThreadIndex: async () => {},
        })
    } finally {
        await rm(root, {
            recursive: true,
            force: true,
        })
    }
}

describe('Pi runtime session tools', () => {
    it('exposes canonical memory tools to programmer rooms', async () => {
        await withToolInput('programmer', (input) => {
            const names = createPiRuntimeCustomTools(input).map((tool) => tool.name)

            expect(names).toContain('agent_room_memory_read')
            expect(names).toContain('agent_room_memory_patch')
            expect(names).toContain('agent_room_memory_replace')
            expect(names).toContain('agent_room_shell')
            expect(names).toContain('agent_room_subagent')
            expect(names).toContain('agent_room_deep_work')
        })
    })

    it('keeps orchestration tools out of child work threads', async () => {
        await withToolInput(
            'programmer',
            (input) => {
                const names = createPiRuntimeCustomTools(input).map((tool) => tool.name)

                expect(names).not.toContain('agent_room_subagent')
                expect(names).not.toContain('agent_room_deep_work')
            },
            'deep_work',
        )
    })

    it('keeps artifact import and export out of programmer mode', async () => {
        await withToolInput('programmer', (input) => {
            const names = createPiRuntimeCustomTools(input).map((tool) => tool.name)

            expect(names).not.toContain('agent_room_artifact_import')
            expect(names).not.toContain('agent_room_artifact_export')
        })
    })
})
