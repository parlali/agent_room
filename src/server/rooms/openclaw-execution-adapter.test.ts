import { describe, expect, it } from 'vitest'
import { __testing } from './openclaw-execution-adapter'

describe('openclaw execution adapter mappings', () => {
    it('resolves agent id from scoped session keys', () => {
        expect(__testing.parseSessionAgentId('agent:ops:main', 'main')).toBe('ops')
        expect(__testing.parseSessionAgentId('global', 'main')).toBe('main')
        expect(__testing.parseSessionAgentId('agent::main', 'main')).toBe('main')
    })

    it('normalizes transcript payloads into chat messages', () => {
        const messages = __testing.mapMessages([
            {
                role: 'user',
                content: 'first message',
                timestamp: 1000,
                id: 'u-1',
            },
            {
                message: {
                    role: 'assistant',
                    content: [
                        {
                            type: 'text',
                            text: 'hello',
                        },
                        {
                            type: 'text',
                            text: 'world',
                        },
                    ],
                    timestamp: 2000,
                },
            },
            {
                role: 'custom',
                content: [
                    {
                        type: 'tool_result',
                        content: 'structured payload',
                    },
                ],
                timestamp: 'invalid',
            },
        ])

        expect(messages).toHaveLength(3)
        expect(messages[0]).toMatchObject({
            id: 'u-1',
            role: 'user',
            text: 'first message',
            timestamp: 1000,
        })
        expect(messages[1]).toMatchObject({
            id: 'message-2',
            role: 'assistant',
            text: 'hello\nworld',
            timestamp: 2000,
            parts: [
                {
                    type: 'text',
                    text: 'hello',
                },
                {
                    type: 'text',
                    text: 'world',
                },
            ],
        })
        expect(messages[2]).toMatchObject({
            id: 'message-3',
            role: 'other',
            text: 'structured payload',
            timestamp: null,
            parts: [
                {
                    type: 'tool_result',
                    text: 'structured payload',
                },
            ],
        })
    })

    it('preserves tool-call structure from transcript content blocks', () => {
        const messages = __testing.mapMessages([
            {
                role: 'assistant',
                content: [
                    {
                        type: 'tool_call',
                        id: 'call-1',
                        name: 'web_fetch',
                        arguments: {
                            url: 'https://example.com',
                        },
                        status: 'start',
                    },
                ],
                timestamp: 3000,
            },
        ])

        expect(messages[0]).toMatchObject({
            role: 'assistant',
            text: 'Tool call: web_fetch',
            parts: [
                {
                    type: 'tool_call',
                    toolName: 'web_fetch',
                    toolCallId: 'call-1',
                    status: 'start',
                    input: {
                        url: 'https://example.com',
                    },
                },
            ],
        })
    })

    it('formats cron schedules and payload summaries', () => {
        expect(__testing.formatCronSchedule({ kind: 'every', everyMs: 300_000 })).toBe(
            'every 5 min',
        )
        expect(
            __testing.formatCronSchedule({
                kind: 'cron',
                expr: '0 8 * * *',
                tz: 'UTC',
            }),
        ).toBe('0 8 * * * (UTC)')
        expect(
            __testing.formatCronPayload({
                kind: 'agentTurn',
                message: 'Produce morning brief',
            }),
        ).toBe('Produce morning brief')
    })

    it('maps cron jobs into room trigger view models', () => {
        const job = __testing.mapCronJob({
            id: 'job-1',
            agentId: 'ops',
            sessionKey: 'cron:job-1',
            name: 'Ops Brief',
            enabled: true,
            sessionTarget: 'isolated',
            wakeMode: 'now',
            schedule: {
                kind: 'every',
                everyMs: 600_000,
            },
            payload: {
                kind: 'agentTurn',
                message: 'Summarize overnight incidents',
            },
            state: {
                nextRunAtMs: 1_700_000_000_000,
                lastRunAtMs: 1_699_999_000_000,
                lastRunStatus: 'ok',
                lastDurationMs: 45_000,
            },
        })

        expect(job).toMatchObject({
            id: 'job-1',
            agentId: 'ops',
            enabled: true,
            scheduleSummary: 'every 10 min',
            payloadSummary: 'Summarize overnight incidents',
            lastRunStatus: 'ok',
            lastDurationMs: 45_000,
        })
    })

    it('treats successful cron.run acknowledgements without a ran flag as started', () => {
        expect(__testing.mapCronRunResult({ ok: true })).toEqual({
            ran: true,
            reason: null,
        })
        expect(__testing.mapCronRunResult({ ok: false })).toEqual({
            ran: false,
            reason: 'Runtime did not return a block reason',
        })
    })

    it('classifies trigger ownership by expected and session agent', () => {
        expect(
            __testing.resolveOwnership({
                effectiveAgentId: 'ops',
                sessionAgentId: 'ops',
            }),
        ).toBe('owned')

        expect(
            __testing.resolveOwnership({
                effectiveAgentId: 'ops',
                sessionAgentId: 'trader',
            }),
        ).toBe('mismatch')

        expect(
            __testing.resolveOwnership({
                effectiveAgentId: null,
                sessionAgentId: 'ops',
            }),
        ).toBe('unknown')
    })

    it('maps run history entries with deterministic ownership linkage', () => {
        const mapped = __testing.mapRunHistoryEntry({
            entry: {
                ts: 1_700_000_000_000,
                jobId: 'job-1',
                status: 'ok',
                summary: 'done',
                sessionKey: 'agent:ops:cron:job-1',
                durationMs: 22_000,
            },
            index: 0,
            job: {
                id: 'job-1',
                name: 'Ops Sweep',
                enabled: true,
                agentId: 'ops',
                schedule: {
                    kind: 'every',
                    everyMs: 300_000,
                },
            },
            defaultAgentId: 'main',
        })

        expect(mapped).toMatchObject({
            jobId: 'job-1',
            jobName: 'Ops Sweep',
            effectiveAgentId: 'ops',
            resolvedSessionAgentId: 'ops',
            ownership: 'owned',
            durationMs: 22_000,
        })

        const mismatch = __testing.mapRunHistoryEntry({
            entry: {
                ts: 1_700_000_000_111,
                jobId: 'job-2',
                status: 'error',
                sessionKey: 'agent:trader:cron:job-2',
            },
            index: 1,
            job: {
                id: 'job-2',
                name: 'Ops Alert',
                enabled: true,
                agentId: 'ops',
                schedule: {
                    kind: 'every',
                    everyMs: 300_000,
                },
            },
            defaultAgentId: 'main',
        })

        expect(mismatch.ownership).toBe('mismatch')
        expect(mismatch.effectiveAgentId).toBe('ops')
        expect(mismatch.resolvedSessionAgentId).toBe('trader')
    })

    it('treats the default runtime agent as the room brain and surfaces extras as drift', () => {
        const resolved = __testing.resolveRoomBrain({
            defaultAgentId: 'marketing',
            agents: [
                {
                    id: 'marketing',
                    name: 'Marketing',
                    workspace: '/room/workspace',
                    model: {
                        primary: 'gpt-5.4',
                    },
                },
                {
                    id: 'shadow',
                    name: 'Shadow',
                },
            ],
            threads: [
                {
                    key: 'agent:marketing:session-1',
                    sessionId: 'session-1',
                    agentId: 'marketing',
                    title: 'Campaign draft',
                    lastMessagePreview: 'latest',
                    status: 'running',
                    updatedAt: 1000,
                    runtimeMs: 1200,
                    model: 'gpt-5.4',
                    modelProvider: 'openai',
                    totalTokens: 10,
                    estimatedCostUsd: 0.1,
                },
                {
                    key: 'agent:shadow:session-2',
                    sessionId: 'session-2',
                    agentId: 'shadow',
                    title: 'Unexpected',
                    lastMessagePreview: 'drift',
                    status: 'idle',
                    updatedAt: 900,
                    runtimeMs: null,
                    model: null,
                    modelProvider: null,
                    totalTokens: null,
                    estimatedCostUsd: null,
                },
            ],
        })

        expect(resolved.roomAgent).toMatchObject({
            id: 'marketing',
            threadCount: 1,
            activeThreadCount: 1,
        })
        expect(resolved.extraAgentIds).toEqual(['shadow'])
    })
})
