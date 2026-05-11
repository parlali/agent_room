import { join } from 'node:path'
import type { SessionEntry } from '@mariozechner/pi-coding-agent'
import { describe, expect, it } from 'vitest'
import { createTestPiRuntimeConfig } from './test-runtime-defaults'
import { extractSessionArtifacts } from './session-artifacts'

const config = createTestPiRuntimeConfig({
    root: '/rooms/one',
})

function messageEntry(
    id: string,
    timestamp: string,
    message: Record<string, unknown>,
): SessionEntry {
    return {
        id,
        parentId: null,
        type: 'message',
        timestamp,
        message,
    } as unknown as SessionEntry
}

describe('session artifact extraction', () => {
    it('extracts user attachments from persisted message text', () => {
        const artifacts = extractSessionArtifacts(config, [
            messageEntry('user-1', '2026-05-11T09:00:00.000Z', {
                role: 'user',
                content: [
                    {
                        type: 'text',
                        text: [
                            'Review these.',
                            '',
                            'Attached files:',
                            '- spec.docx (9 KB) root=store path="attachments/run/spec.docx"',
                            '- diagram.png (12 KB) root=workspace path="assets/diagram.png"',
                        ].join('\n'),
                    },
                ],
            }),
        ])

        expect(artifacts).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    id: 'store:attachments/run/spec.docx',
                    kind: 'attached',
                    name: 'spec.docx',
                    surface: 'store',
                    relativePath: 'attachments/run/spec.docx',
                    source: 'Attached by user',
                }),
                expect.objectContaining({
                    id: 'workspace:assets/diagram.png',
                    kind: 'attached',
                    name: 'diagram.png',
                    surface: 'workspace',
                    relativePath: 'assets/diagram.png',
                    source: 'Attached by user',
                }),
            ]),
        )
    })

    it('extracts created and edited files from tool result details', () => {
        const artifacts = extractSessionArtifacts(config, [
            messageEntry('assistant-1', '2026-05-11T09:00:01.000Z', {
                role: 'assistant',
                content: [
                    {
                        type: 'toolCall',
                        id: 'call-write',
                        name: 'agent_room_write',
                        arguments: {
                            path: 'notes/summary.md',
                        },
                    },
                ],
            }),
            messageEntry('tool-1', '2026-05-11T09:00:02.000Z', {
                role: 'toolResult',
                toolCallId: 'call-write',
                content: [{ type: 'text', text: 'Wrote notes/summary.md' }],
                details: {
                    path: join(config.paths.workspaceDir, 'notes/summary.md'),
                    operation: 'create',
                    byteLength: 42,
                },
            }),
            messageEntry('assistant-2', '2026-05-11T09:00:03.000Z', {
                role: 'assistant',
                content: [
                    {
                        type: 'toolCall',
                        id: 'call-edit',
                        name: 'agent_room_edit',
                        arguments: {
                            path: 'notes/summary.md',
                        },
                    },
                ],
            }),
            messageEntry('tool-2', '2026-05-11T09:00:04.000Z', {
                role: 'toolResult',
                toolCallId: 'call-edit',
                content: [{ type: 'text', text: 'Edited notes/summary.md' }],
                details: {
                    fileChange: {
                        kind: 'edit',
                        path: join(config.paths.workspaceDir, 'notes/summary.md'),
                        byteLength: 50,
                    },
                },
            }),
        ])

        expect(artifacts).toHaveLength(1)
        expect(artifacts[0]).toMatchObject({
            id: 'workspace:notes/summary.md',
            kind: 'edited',
            name: 'summary.md',
            relativePath: 'notes/summary.md',
            byteLength: 50,
            toolName: 'agent_room_edit',
        })
    })

    it('hides internal store blobs while keeping session uploads', () => {
        const artifacts = extractSessionArtifacts(config, [
            messageEntry('assistant-1', '2026-05-11T09:00:01.000Z', {
                role: 'assistant',
                content: [
                    {
                        type: 'toolCall',
                        id: 'call-read',
                        name: 'agent_room_read',
                        arguments: {
                            root: 'store',
                            path: 'blobs/abc123',
                        },
                    },
                ],
            }),
            messageEntry('tool-1', '2026-05-11T09:00:02.000Z', {
                role: 'toolResult',
                toolCallId: 'call-read',
                content: [{ type: 'text', text: 'internal blob' }],
                details: {
                    root: 'store',
                    path: 'blobs/abc123',
                },
            }),
            messageEntry('user-1', '2026-05-11T09:00:03.000Z', {
                role: 'user',
                content:
                    'Attached files:\n- source.pdf (5 KB) root=store path="attachments/session/source.pdf"',
            }),
        ])

        expect(artifacts).toHaveLength(1)
        expect(artifacts[0]).toMatchObject({
            id: 'store:attachments/session/source.pdf',
            kind: 'attached',
        })
    })
})
