import { describe, expect, it } from 'vitest'
import { emptyRuntimePart } from './runtime-message'
import { summarizeToolTasks, toolTasksFromParts } from './tool-activity'

describe('tool activity model', () => {
    it('treats completed persisted tool calls as done even before pairing the result row', () => {
        const tasks = toolTasksFromParts([
            emptyRuntimePart({
                type: 'tool_call',
                toolName: 'read',
                toolCallId: 'call-1',
                status: 'complete',
                input: {
                    path: 'notes/product.md',
                },
            }),
        ])

        expect(tasks).toMatchObject([
            {
                id: 'call-1',
                title: 'Checked files',
                status: 'complete',
                detail: 'File: notes/product.md',
            },
        ])
    })

    it('summarizes grouped tool tasks as readable activity', () => {
        expect(
            summarizeToolTasks([
                {
                    id: 'read-1',
                    title: 'Checked files',
                    action: 'read',
                    status: 'complete',
                    detail: 'File: src/app.ts',
                    result: null,
                },
                {
                    id: 'read-2',
                    title: 'Checked files',
                    action: 'read',
                    status: 'complete',
                    detail: 'File: src/lib.ts',
                    result: null,
                },
                {
                    id: 'search-1',
                    title: 'Searched files',
                    action: 'searched',
                    status: 'complete',
                    detail: 'Reference: formatDurationMs',
                    result: null,
                },
                {
                    id: 'command-1',
                    title: 'Ran workspace command',
                    action: 'ran',
                    status: 'complete',
                    detail: null,
                    result: null,
                },
            ]),
        ).toBe('Explored 2 files, 1 search, ran 1 command')
    })
})
