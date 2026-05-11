import { describe, expect, it } from 'vitest'
import { emptyRuntimePart } from '#/lib/runtime-message'
import { toolTasksFromParts } from './tool-activity-model'

describe('tool activity model', () => {
    it('treats completed persisted tool calls as done even before pairing the result row', () => {
        const tasks = toolTasksFromParts([
            emptyRuntimePart({
                type: 'tool_call',
                toolName: 'agent_room_read',
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
})
