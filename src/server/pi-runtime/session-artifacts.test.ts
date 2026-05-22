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

    it('extracts explicitly promoted created and edited files from tool result details', () => {
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
                    artifactId: 'summary-artifact',
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
                    artifactId: 'summary-artifact',
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
            artifactId: 'summary-artifact',
            byteLength: 50,
            toolName: 'edit',
        })
    })

    it('excludes read-only legacy absolute room-id paths from primary artifacts', () => {
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

        expect(artifacts).toEqual([])
    })

    it('rejects parent-traversal relative paths from artifact state', () => {
        const artifacts = extractSessionArtifacts(config, [
            messageEntry('assistant-1', '2026-05-11T09:00:01.000Z', {
                role: 'assistant',
                content: [
                    {
                        type: 'toolCall',
                        id: 'call-read',
                        name: 'read',
                        arguments: {
                            path: '../outside.md',
                        },
                    },
                ],
            }),
            messageEntry('tool-1', '2026-05-11T09:00:02.000Z', {
                role: 'toolResult',
                toolCallId: 'call-read',
                content: [{ type: 'text', text: 'outside' }],
                details: {
                    path: '../outside.md',
                    byteLength: 11,
                },
            }),
        ])

        expect(artifacts).toEqual([])
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

    it('excludes saved bounded tool outputs unless explicitly promoted', () => {
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

        expect(artifacts).toEqual([])
    })

    it('excludes scratch writes while keeping explicitly promoted deliverables', () => {
        const artifacts = extractSessionArtifacts(config, [
            messageEntry('assistant-1', '2026-05-11T09:00:01.000Z', {
                role: 'assistant',
                content: [
                    {
                        type: 'toolCall',
                        id: 'call-scratch',
                        name: 'write',
                        arguments: {
                            path: 'scratch/build-report.py',
                        },
                    },
                    {
                        type: 'toolCall',
                        id: 'call-deliverable',
                        name: 'artifact_export',
                        arguments: {
                            path: 'deliverables/report.pdf',
                        },
                    },
                ],
            }),
            messageEntry('tool-1', '2026-05-11T09:00:02.000Z', {
                role: 'toolResult',
                toolCallId: 'call-scratch',
                content: [{ type: 'text', text: 'Wrote scratch/build-report.py' }],
                details: {
                    path: join(config.paths.workspaceDir, 'scratch/build-report.py'),
                    operation: 'create',
                    byteLength: 200,
                },
            }),
            messageEntry('tool-2', '2026-05-11T09:00:03.000Z', {
                role: 'toolResult',
                toolCallId: 'call-deliverable',
                content: [{ type: 'text', text: 'Exported deliverables/report.pdf' }],
                details: {
                    path: join(config.paths.workspaceDir, 'deliverables/report.pdf'),
                    operation: 'artifact_export',
                    artifactId: 'report-artifact',
                    byteLength: 2048,
                },
            }),
        ])

        expect(artifacts).toEqual([
            expect.objectContaining({
                id: 'workspace:deliverables/report.pdf',
                kind: 'created',
                relativePath: 'deliverables/report.pdf',
                artifactId: 'report-artifact',
                byteLength: 2048,
            }),
        ])
    })

    it('promotes bundled Office skill shell create outputs without listing arbitrary shell files', () => {
        const artifacts = extractSessionArtifacts(config, [
            messageEntry('assistant-office', '2026-05-11T09:00:01.000Z', {
                role: 'assistant',
                content: [
                    {
                        type: 'toolCall',
                        id: 'call-office-create',
                        name: 'shell',
                        arguments: {
                            command:
                                'bun /app/src/server/pi-runtime/skills/docx/scripts/docx_document.ts create --path deliverables/resolution.docx --content-json "{}"',
                        },
                    },
                    {
                        type: 'toolCall',
                        id: 'call-office-inspect',
                        name: 'shell',
                        arguments: {
                            command:
                                'bun /app/src/server/pi-runtime/skills/docx/scripts/docx_document.ts inspect --path deliverables/resolution.docx',
                        },
                    },
                    {
                        type: 'toolCall',
                        id: 'call-arbitrary-shell',
                        name: 'shell',
                        arguments: {
                            command: 'printf "%s" scratch.txt',
                        },
                    },
                ],
            }),
            messageEntry('tool-office-create', '2026-05-11T09:00:02.000Z', {
                role: 'toolResult',
                toolCallId: 'call-office-create',
                toolName: 'shell',
                content: [
                    {
                        type: 'text',
                        text: [
                            'commandId: command-1',
                            'status: exited',
                            'exitCode: 0',
                            '',
                            JSON.stringify({
                                operation: 'create',
                                format: 'docx',
                                root: 'workspace',
                                path: 'deliverables/resolution.docx',
                            }),
                        ].join('\n'),
                    },
                ],
                details: {
                    path: config.paths.workspaceDir,
                    exitCode: 0,
                    truncated: false,
                    modelVisibleTruncated: false,
                },
            }),
            messageEntry('tool-office-inspect', '2026-05-11T09:00:03.000Z', {
                role: 'toolResult',
                toolCallId: 'call-office-inspect',
                toolName: 'shell',
                content: [
                    {
                        type: 'text',
                        text: JSON.stringify({
                            operation: 'inspect',
                            format: 'docx',
                            root: 'workspace',
                            path: 'deliverables/resolution.docx',
                            text: 'Verified document text',
                        }),
                    },
                ],
                details: {
                    path: config.paths.workspaceDir,
                    exitCode: 0,
                },
            }),
            messageEntry('tool-arbitrary-shell', '2026-05-11T09:00:04.000Z', {
                role: 'toolResult',
                toolCallId: 'call-arbitrary-shell',
                toolName: 'shell',
                content: [
                    {
                        type: 'text',
                        text: JSON.stringify({
                            operation: 'create',
                            format: 'docx',
                            root: 'workspace',
                            path: 'scratch.txt',
                        }),
                    },
                ],
                details: {
                    path: config.paths.workspaceDir,
                    exitCode: 0,
                },
            }),
        ])

        expect(artifacts).toEqual([
            expect.objectContaining({
                id: 'workspace:deliverables/resolution.docx',
                kind: 'created',
                name: 'resolution.docx',
                relativePath: 'deliverables/resolution.docx',
                source: 'docx create',
                toolName: 'docx',
                operation: 'create',
                artifactId: null,
            }),
        ])
    })

    it('promotes bundled Office skill shell edit outputs as edits', () => {
        const artifacts = extractSessionArtifacts(config, [
            messageEntry('assistant-office', '2026-05-11T09:00:01.000Z', {
                role: 'assistant',
                content: [
                    {
                        type: 'toolCall',
                        id: 'call-office-edit',
                        name: 'shell',
                        arguments: {
                            command:
                                'bun /app/src/server/pi-runtime/skills/xlsx/scripts/xlsx_workbook.ts edit --path model.xlsx --edits-json "[]"',
                        },
                    },
                ],
            }),
            messageEntry('tool-office-edit', '2026-05-11T09:00:02.000Z', {
                role: 'toolResult',
                toolCallId: 'call-office-edit',
                toolName: 'shell',
                content: [
                    {
                        type: 'text',
                        text: JSON.stringify({
                            operation: 'edit',
                            format: 'xlsx',
                            root: 'workspace',
                            path: 'model.xlsx',
                        }),
                    },
                ],
                details: {
                    path: config.paths.workspaceDir,
                    exitCode: 0,
                },
            }),
        ])

        expect(artifacts).toEqual([
            expect.objectContaining({
                id: 'workspace:model.xlsx',
                kind: 'edited',
                name: 'model.xlsx',
                relativePath: 'model.xlsx',
                source: 'xlsx edit',
                toolName: 'xlsx',
                operation: 'edit',
            }),
        ])
    })

    it('promotes emitted Office render PDFs without promoting preview pages', () => {
        const artifacts = extractSessionArtifacts(config, [
            messageEntry('assistant-office-render', '2026-05-11T09:00:01.000Z', {
                role: 'assistant',
                content: [
                    {
                        type: 'toolCall',
                        id: 'call-office-render',
                        name: 'shell',
                        arguments: {
                            command:
                                'bun /app/src/server/pi-runtime/skills/docx/scripts/docx_document.ts render --path report.docx --output-dir _renders/report --emit-pdf true',
                        },
                    },
                ],
            }),
            messageEntry('tool-office-render', '2026-05-11T09:00:02.000Z', {
                role: 'toolResult',
                toolCallId: 'call-office-render',
                toolName: 'shell',
                content: [
                    {
                        type: 'text',
                        text: JSON.stringify({
                            operation: 'render',
                            format: 'docx',
                            root: 'workspace',
                            path: 'report.docx',
                            outputDir: '_renders/report',
                            pages: ['_renders/report/page-1.png'],
                            pdfPath: '_renders/report/report.pdf',
                        }),
                    },
                ],
                details: {
                    path: config.paths.workspaceDir,
                    exitCode: 0,
                },
            }),
        ])

        expect(artifacts).toEqual([
            expect.objectContaining({
                id: 'workspace:_renders/report/report.pdf',
                kind: 'created',
                name: 'report.pdf',
                relativePath: '_renders/report/report.pdf',
                source: 'docx render',
                toolName: 'docx',
                operation: 'render',
            }),
        ])
    })

    it('promotes emitted Office render PDFs from store-backed source files', () => {
        const artifacts = extractSessionArtifacts(config, [
            messageEntry('assistant-office-render-store', '2026-05-11T09:00:01.000Z', {
                role: 'assistant',
                content: [
                    {
                        type: 'toolCall',
                        id: 'call-office-render-store',
                        name: 'shell',
                        arguments: {
                            command:
                                'bun /app/src/server/pi-runtime/skills/pptx/scripts/pptx_deck.ts render --root store --path uploads/deck.pptx --output-dir _renders/deck --emit-pdf true',
                        },
                    },
                ],
            }),
            messageEntry('tool-office-render-store', '2026-05-11T09:00:02.000Z', {
                role: 'toolResult',
                toolCallId: 'call-office-render-store',
                toolName: 'shell',
                content: [
                    {
                        type: 'text',
                        text: JSON.stringify({
                            operation: 'render',
                            format: 'pptx',
                            root: 'store',
                            outputRoot: 'workspace',
                            path: 'uploads/deck.pptx',
                            outputDir: '_renders/deck',
                            pages: ['_renders/deck/page-1.png'],
                            pdfPath: '_renders/deck/deck.pdf',
                        }),
                    },
                ],
                details: {
                    path: config.paths.workspaceDir,
                    exitCode: 0,
                },
            }),
        ])

        expect(artifacts).toEqual([
            expect.objectContaining({
                id: 'workspace:_renders/deck/deck.pdf',
                kind: 'created',
                name: 'deck.pdf',
                relativePath: '_renders/deck/deck.pdf',
                source: 'pptx render',
                toolName: 'pptx',
                operation: 'render',
            }),
        ])
    })

    it('does not promote failed or mismatched bundled Office shell output', () => {
        const artifacts = extractSessionArtifacts(config, [
            messageEntry('assistant-office', '2026-05-11T09:00:01.000Z', {
                role: 'assistant',
                content: [
                    {
                        type: 'toolCall',
                        id: 'call-office-failed',
                        name: 'shell',
                        arguments: {
                            command:
                                'bun /app/src/server/pi-runtime/skills/pptx/scripts/pptx_deck.ts create --path deck.pptx --content-json "{}"',
                        },
                    },
                    {
                        type: 'toolCall',
                        id: 'call-office-mismatch',
                        name: 'shell',
                        arguments: {
                            command:
                                'bun /app/src/server/pi-runtime/skills/pptx/scripts/pptx_deck.ts create --path report.docx --content-json "{}"',
                        },
                    },
                    {
                        type: 'toolCall',
                        id: 'call-office-extension-mismatch',
                        name: 'shell',
                        arguments: {
                            command:
                                'bun /app/src/server/pi-runtime/skills/docx/scripts/docx_document.ts create --path report.txt --content-json "{}"',
                        },
                    },
                    {
                        type: 'toolCall',
                        id: 'call-office-missing-root',
                        name: 'shell',
                        arguments: {
                            command:
                                'bun /app/src/server/pi-runtime/skills/docx/scripts/docx_document.ts create --path report.docx --content-json "{}"',
                        },
                    },
                ],
            }),
            messageEntry('tool-office-failed', '2026-05-11T09:00:02.000Z', {
                role: 'toolResult',
                toolCallId: 'call-office-failed',
                toolName: 'shell',
                content: [
                    {
                        type: 'text',
                        text: JSON.stringify({
                            operation: 'create',
                            format: 'pptx',
                            root: 'workspace',
                            path: 'deck.pptx',
                        }),
                    },
                ],
                details: {
                    path: config.paths.workspaceDir,
                    exitCode: 1,
                },
            }),
            messageEntry('tool-office-mismatch', '2026-05-11T09:00:03.000Z', {
                role: 'toolResult',
                toolCallId: 'call-office-mismatch',
                toolName: 'shell',
                content: [
                    {
                        type: 'text',
                        text: JSON.stringify({
                            operation: 'create',
                            format: 'docx',
                            root: 'workspace',
                            path: 'report.docx',
                        }),
                    },
                ],
                details: {
                    path: config.paths.workspaceDir,
                    exitCode: 0,
                },
            }),
            messageEntry('tool-office-extension-mismatch', '2026-05-11T09:00:04.000Z', {
                role: 'toolResult',
                toolCallId: 'call-office-extension-mismatch',
                toolName: 'shell',
                content: [
                    {
                        type: 'text',
                        text: JSON.stringify({
                            operation: 'create',
                            format: 'docx',
                            root: 'workspace',
                            path: 'report.txt',
                        }),
                    },
                ],
                details: {
                    path: config.paths.workspaceDir,
                    exitCode: 0,
                },
            }),
            messageEntry('tool-office-missing-root', '2026-05-11T09:00:05.000Z', {
                role: 'toolResult',
                toolCallId: 'call-office-missing-root',
                toolName: 'shell',
                content: [
                    {
                        type: 'text',
                        text: JSON.stringify({
                            operation: 'create',
                            format: 'docx',
                            path: 'report.docx',
                        }),
                    },
                ],
                details: {
                    path: config.paths.workspaceDir,
                    exitCode: 0,
                },
            }),
        ])

        expect(artifacts).toEqual([])
    })
})
