import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type {
    ChatTimelineRow,
    RoomRuntimeOverview,
    RunTranscriptRow,
} from '#/domain/room-execution-types'
import { DisplayRow } from './message-rows'

const room: RoomRuntimeOverview = {
    roomId: 'room-1',
    displayName: 'Agent Room',
    slug: 'agent-room',
    status: 'running',
    desiredState: 'running',
    roomMode: 'programmer',
    healthStatus: null,
    port: null,
    pid: null,
    lastError: null,
    lastHealthAt: null,
}

describe('message rows transcript rendering', () => {
    it('renders an active transcript header with a live timer and expandable controls', () => {
        const html = renderToStaticMarkup(
            rowElement({
                status: 'working',
                collapsed: false,
                items: [
                    {
                        type: 'model_text',
                        id: 'commentary-1',
                        turnIndex: 0,
                        contentIndex: 0,
                        markdown: 'Checking the file',
                        complete: true,
                        phase: 'commentary',
                        timestamp: 1,
                    },
                ],
            }),
        )

        expect(html).toContain('Working for')
        expect(html).toContain('aria-expanded="true"')
    })

    it('renders completed transcript items behind an expandable header', () => {
        const html = renderToStaticMarkup(
            rowElement({
                status: 'complete',
                collapsed: true,
                runtimeMs: 2000,
                items: [
                    {
                        type: 'model_text',
                        id: 'commentary-1',
                        turnIndex: 0,
                        contentIndex: 0,
                        markdown: 'Checked the file',
                        complete: true,
                        phase: 'commentary',
                        timestamp: 1,
                    },
                    {
                        type: 'tool_activity',
                        id: 'tool-call-1',
                        turnIndex: 0,
                        contentIndex: 1,
                        toolCallId: 'call-1',
                        task: {
                            id: 'call-1',
                            title: 'Checked files',
                            action: 'read',
                            status: 'complete',
                            detail: 'File: src/app.ts',
                            result: 'Workspace information was provided to the agent',
                        },
                        timestamp: 1,
                    },
                ],
            }),
        )

        expect(html).toContain('Worked for')
        expect(html).toContain('data-slot="button"')
        expect(html).toContain('aria-expanded="false"')
        expect(html).not.toContain('Checked the file')
    })

    it('does not render missing completed duration as worked for now', () => {
        const html = renderToStaticMarkup(
            rowElement({
                status: 'complete',
                collapsed: true,
                startedAt: null,
                runtimeMs: null,
                items: [
                    {
                        type: 'model_text',
                        id: 'commentary-1',
                        turnIndex: 0,
                        contentIndex: 0,
                        markdown: 'Checked the file',
                        complete: true,
                        phase: 'commentary',
                        timestamp: 1,
                    },
                ],
            }),
        )

        expect(html).toContain('Worked')
        expect(html).not.toContain('Worked for now')
    })

    it('keeps a collapsed responding transcript active while final text streams', () => {
        const html = renderToStaticMarkup(
            rowElement({
                status: 'responding',
                collapsed: true,
                items: [
                    {
                        type: 'model_text',
                        id: 'commentary-1',
                        turnIndex: 0,
                        contentIndex: 0,
                        markdown: 'Checked the file',
                        complete: true,
                        phase: 'commentary',
                        timestamp: 1,
                    },
                ],
            }),
        )

        expect(html).toContain('Working for')
        expect(html).toContain('aria-expanded="false"')
    })

    it('does not repeat the room glyph for a final answer continuing transcript work', () => {
        const standalone = renderToStaticMarkup(assistantFinalElement(false))
        const continued = renderToStaticMarkup(assistantFinalElement(true))

        expect(standalone).toContain('>AR<')
        expect(continued).not.toContain('>AR<')
        expect(continued).toContain('Done')
    })

    it('renders model thinking as normal transcript text without reasoning chrome', () => {
        const html = renderToStaticMarkup(
            rowElement({
                status: 'complete',
                collapsed: false,
                runtimeMs: 2000,
                items: [
                    {
                        type: 'model_text',
                        id: 'thinking-1',
                        turnIndex: 0,
                        contentIndex: 0,
                        markdown: 'raw thought',
                        complete: true,
                        phase: 'thinking',
                        timestamp: 1,
                    },
                    {
                        type: 'model_text',
                        id: 'model-text-1',
                        turnIndex: 0,
                        contentIndex: 1,
                        markdown: 'Checked the file',
                        complete: true,
                        phase: 'commentary',
                        timestamp: 1,
                    },
                ],
            }),
        )

        expect(html).not.toContain('Reasoning')
        expect(html).toContain('raw thought')
        expect(html).toContain('Checked the file')
    })

    it('makes completed thinking text expandable as transcript work', () => {
        const html = renderToStaticMarkup(
            rowElement({
                status: 'complete',
                collapsed: true,
                runtimeMs: 2000,
                items: [
                    {
                        type: 'model_text',
                        id: 'thinking-1',
                        turnIndex: 0,
                        contentIndex: 0,
                        markdown: 'raw thought',
                        complete: true,
                        phase: 'thinking',
                        timestamp: 1,
                    },
                ],
            }),
        )

        expect(html).toContain('Worked for')
        expect(html).toContain('aria-expanded="false"')
        expect(html).not.toContain('raw thought')
    })

    it('groups consecutive tool activity into one collapsed transcript block', () => {
        const html = renderToStaticMarkup(
            rowElement({
                status: 'complete',
                collapsed: false,
                runtimeMs: 2000,
                items: [
                    {
                        type: 'model_text',
                        id: 'commentary-1',
                        turnIndex: 0,
                        contentIndex: 0,
                        markdown: 'Checking both files',
                        complete: true,
                        phase: 'commentary',
                        timestamp: 1,
                    },
                    toolActivity('tool-call-1', 'call-1', 1, 'src/app.ts'),
                    toolActivity('tool-call-2', 'call-2', 2, 'src/lib.ts'),
                    {
                        type: 'model_text',
                        id: 'commentary-2',
                        turnIndex: 0,
                        contentIndex: 3,
                        markdown: 'Now I have context',
                        complete: true,
                        phase: 'commentary',
                        timestamp: 1,
                    },
                    toolActivity('tool-call-3', 'call-3', 4, 'src/main.ts'),
                ],
            }),
        )

        expect(html).toContain('Checking both files')
        expect(html).toContain('Explored 2 files')
        expect(html).toContain('Now I have context')
        expect(html).toContain('Checked files')
        expect(html.indexOf('Checking both files')).toBeLessThan(html.indexOf('Explored 2 files'))
        expect(html.indexOf('Explored 2 files')).toBeLessThan(html.indexOf('Now I have context'))
        expect(html.indexOf('Now I have context')).toBeLessThan(html.indexOf('Checked files'))
        expect(html.match(/Explored 2 files/g)).toHaveLength(1)
    })
})

function rowElement(input: Partial<RunTranscriptRow>) {
    const row: RunTranscriptRow = {
        type: 'run_transcript',
        id: 'run-transcript-run-1',
        seq: 0,
        runId: 'run-1',
        status: input.status ?? 'working',
        startedAt: input.startedAt === undefined ? Date.now() - 1000 : input.startedAt,
        runtimeMs: input.runtimeMs ?? null,
        collapsed: input.collapsed ?? false,
        items: input.items ?? [],
        timestamp: 1,
    }
    return (
        <DisplayRow
            room={room}
            item={row}
            canEditMessages={false}
            editingMessage={null}
            editPending={false}
            onEditMessage={() => {}}
            onChangeEditingMessageText={() => {}}
            onSubmitEditingMessage={() => {}}
            onCancelEditingMessage={() => {}}
            transcriptCollapsed={row.collapsed}
            onToggleTranscript={() => {}}
        />
    )
}

function assistantFinalElement(assistantContinuesPrevious: boolean) {
    const row: ChatTimelineRow = {
        type: 'assistant_final',
        id: 'assistant-final-1',
        seq: 1,
        message: {
            id: 'assistant-1',
            role: 'assistant',
            text: 'Done',
            parts: [],
            timestamp: 1,
        },
        streaming: false,
        timestamp: 1,
    }
    return (
        <DisplayRow
            room={room}
            item={row}
            canEditMessages={false}
            editingMessage={null}
            editPending={false}
            onEditMessage={() => {}}
            onChangeEditingMessageText={() => {}}
            onSubmitEditingMessage={() => {}}
            onCancelEditingMessage={() => {}}
            assistantContinuesPrevious={assistantContinuesPrevious}
        />
    )
}

function toolActivity(
    id: string,
    toolCallId: string,
    contentIndex: number,
    path: string,
): Extract<RunTranscriptRow['items'][number], { type: 'tool_activity' }> {
    return {
        type: 'tool_activity',
        id,
        turnIndex: 0,
        contentIndex,
        toolCallId,
        task: {
            id: toolCallId,
            title: 'Checked files',
            action: 'read',
            status: 'complete',
            detail: `File: ${path}`,
            result: 'Workspace information was provided to the agent',
        },
        timestamp: 1,
    }
}
