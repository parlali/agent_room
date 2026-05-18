import { dirname, join } from 'node:path'
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
                    byteLength: 9216,
                    kind: 'attached',
                    name: 'spec.docx',
                    surface: 'store',
                    relativePath: 'attachments/run/spec.docx',
                    source: 'Attached by user',
                }),
                expect.objectContaining({
                    id: 'workspace:assets/diagram.png',
                    byteLength: 12288,
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
                        name: 'write',
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
                        name: 'edit',
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
            toolName: 'edit',
        })
    })

    it('extracts legacy absolute room-id paths after opaque path migration', () => {
        const legacyWorkspacePath = join(
            dirname(config.paths.roomRootDir),
            config.runtime.roomId,
            'workspace',
            'notes',
            'legacy.md',
        )
        const artifacts = extractSessionArtifacts(config, [
            messageEntry('assistant-1', '2026-05-11T09:00:01.000Z', {
                role: 'assistant',
                content: [
                    {
                        type: 'toolCall',
                        id: 'call-read',
                        name: 'read',
                        arguments: {
                            path: legacyWorkspacePath,
                        },
                    },
                ],
            }),
            messageEntry('tool-1', '2026-05-11T09:00:02.000Z', {
                role: 'toolResult',
                toolCallId: 'call-read',
                content: [{ type: 'text', text: 'legacy' }],
                details: {
                    path: legacyWorkspacePath,
                    byteLength: 11,
                },
            }),
        ])

        expect(artifacts).toEqual([
            expect.objectContaining({
                id: 'workspace:notes/legacy.md',
                kind: 'referenced',
                relativePath: 'notes/legacy.md',
                byteLength: 11,
            }),
        ])
    })

    it('hides internal store blobs while keeping session uploads', () => {
        const artifacts = extractSessionArtifacts(config, [
            messageEntry('assistant-1', '2026-05-11T09:00:01.000Z', {
                role: 'assistant',
                content: [
                    {
                        type: 'toolCall',
                        id: 'call-read',
                        name: 'read',
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
            byteLength: 5120,
            kind: 'attached',
        })
    })

    it('extracts saved bounded tool outputs as referenced artifacts', () => {
        const artifacts = extractSessionArtifacts(config, [
            messageEntry('assistant-1', '2026-05-11T09:00:01.000Z', {
                role: 'assistant',
                content: [
                    {
                        type: 'toolCall',
                        id: 'call-fetch',
                        name: 'fetch_url',
                        arguments: {
                            url: 'https://example.com/data.json',
                        },
                    },
                ],
            }),
            messageEntry('tool-1', '2026-05-11T09:00:02.000Z', {
                role: 'toolResult',
                toolCallId: 'call-fetch',
                content: [{ type: 'text', text: 'preview' }],
                details: {
                    outputArtifact: {
                        root: 'store',
                        path: 'tool-output/thread/run/fetch.txt',
                        byteLength: 90000,
                        modelVisibleByteLength: 32000,
                    },
                },
            }),
        ])

        expect(artifacts).toEqual([
            expect.objectContaining({
                id: 'store:tool-output/thread/run/fetch.txt',
                kind: 'referenced',
                relativePath: 'tool-output/thread/run/fetch.txt',
                source: 'fetch url tool_output',
                byteLength: 90000,
            }),
        ])
    })
})
