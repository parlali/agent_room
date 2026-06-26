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
