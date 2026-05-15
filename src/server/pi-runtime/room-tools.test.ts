import {
    copyFile,
    mkdir,
    mkdtemp,
    readFile,
    realpath,
    rm,
    stat,
    symlink,
    writeFile,
} from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import { PDFDocument } from 'pdf-lib'
import type { Api, Model } from '@mariozechner/pi-ai'
import type { PiRuntimeConfig } from '../rooms/pi-runtime-config'
import { __testing, createRoomTools, roomToolNamesForCapabilities } from './room-tools'
import { createDocumentTools } from './document-tools'
import {
    createTestPiRuntimeConfig,
    ensureTestPiRuntimeDirectories,
    testCapabilities,
} from './test-runtime-defaults'
import { withToolRunContext } from './tool-run-context'

function testConfig(root: string): PiRuntimeConfig {
    return createTestPiRuntimeConfig({ root })
}

async function withRoom<T>(fn: (config: PiRuntimeConfig) => Promise<T>): Promise<T> {
    const root = await mkdtemp(join(tmpdir(), 'agent-room-tools-'))
    const config = testConfig(root)
    const previousUnsandboxedShell = process.env.AGENT_ROOM_UNSAFE_ALLOW_UNSANDBOXED_SHELL
    process.env.AGENT_ROOM_UNSAFE_ALLOW_UNSANDBOXED_SHELL = '1'
    await ensureTestPiRuntimeDirectories(config)
    try {
        return await fn(config)
    } finally {
        if (previousUnsandboxedShell === undefined) {
            delete process.env.AGENT_ROOM_UNSAFE_ALLOW_UNSANDBOXED_SHELL
        } else {
            process.env.AGENT_ROOM_UNSAFE_ALLOW_UNSANDBOXED_SHELL = previousUnsandboxedShell
        }
        await rm(root, {
            recursive: true,
            force: true,
        })
    }
}

async function executeTool(
    config: PiRuntimeConfig,
    name: string,
    input: object,
    signal?: AbortSignal,
) {
    const events: Array<{ event: string; payload: unknown }> = []
    const tools = createRoomTools({
        config,
        audit: async (event, payload) => {
            events.push({ event, payload })
        },
    })
    const tool = tools.find((entry) => entry.name === name)
    if (!tool) {
        throw new Error(`Missing tool ${name}`)
    }
    const result = await tool.execute('call-1', input as never, signal, undefined, {} as never)
    return {
        result,
        events,
    }
}

async function executeDocumentTool(
    config: PiRuntimeConfig,
    name: string,
    input: object,
    signal?: AbortSignal,
    toolContext: object = {},
) {
    const events: Array<{ event: string; payload: unknown }> = []
    const tools = createDocumentTools({
        config,
        audit: async (event, payload) => {
            events.push({ event, payload })
        },
    })
    const tool = tools.find((entry) => entry.name === name)
    if (!tool) {
        throw new Error(`Missing tool ${name}`)
    }
    const result = await tool.execute(
        'call-1',
        input as never,
        signal,
        undefined,
        toolContext as never,
    )
    return {
        result,
        events,
    }
}

function model(input: Array<'text' | 'image'>, overrides: Partial<Model<Api>> = {}): Model<Api> {
    return {
        id: 'test-model',
        name: 'Test Model',
        provider: 'openai',
        api: 'openai-responses',
        baseUrl: 'https://example.test',
        reasoning: false,
        input,
        cost: {
            input: 0,
            output: 0,
            cacheRead: 0,
            cacheWrite: 0,
        },
        contextWindow: 128000,
        maxTokens: 4096,
        ...overrides,
    }
}

function anthropicModel(): Model<Api> {
    return model(['text', 'image'], {
        id: 'claude-sonnet-4-20250514',
        provider: 'anthropic',
        api: 'anthropic-messages',
    })
}

async function writePdfFixture(path: string, pageCount: number): Promise<Buffer> {
    const pdf = await PDFDocument.create()
    for (let page = 0; page < pageCount; page += 1) {
        pdf.addPage([200, 200])
    }
    const bytes = Buffer.from(await pdf.save())
    await writeFile(path, bytes)
    return bytes
}

function resultText(result: Awaited<ReturnType<typeof executeTool>>['result']): string {
    const part = result.content[0]
    return part && 'text' in part && typeof part.text === 'string' ? part.text : ''
}

function resultDetails(result: Awaited<ReturnType<typeof executeTool>>['result']) {
    return typeof result.details === 'object' && result.details !== null
        ? (result.details as Record<string, unknown>)
        : {}
}

describe('room Pi tools', () => {
    it('requires an explicit shell sandbox or test-only unsafe override', () => {
        expect(() =>
            __testing.resolveShellSandboxIdentity({
                nodeEnv: 'production',
                unsafeAllowUnsandboxed: undefined,
                uid: 501,
            }),
        ).toThrow(/requires a sandboxed runtime user/)
        expect(
            __testing.resolveShellSandboxIdentity({
                nodeEnv: 'production',
                unsafeAllowUnsandboxed: undefined,
                uid: 0,
            }),
        ).toEqual({
            uid: 65534,
            gid: 65534,
            mode: 'dropped',
        })
        expect(
            __testing.resolveShellSandboxIdentity({
                nodeEnv: 'test',
                unsafeAllowUnsandboxed: '1',
                uid: 501,
            }),
        ).toEqual({
            mode: 'test-unsafe',
        })
    })

    it('denies file paths outside the room roots', async () => {
        await withRoom(async (config) => {
            await writeFile(join(config.paths.roomRootDir, 'secret.txt'), 'secret', 'utf8')
            await expect(
                executeTool(config, 'agent_room_read', {
                    path: '../secret.txt',
                }),
            ).rejects.toThrow(/escapes allowed root/)
        })
    })

    it('denies symlink escapes for reads and writes', async () => {
        await withRoom(async (config) => {
            const outsideDir = join(config.paths.roomRootDir, 'outside')
            await mkdir(outsideDir, {
                recursive: true,
            })
            await writeFile(join(outsideDir, 'secret.txt'), 'secret', 'utf8')
            await symlink(
                join(outsideDir, 'secret.txt'),
                join(config.paths.workspaceDir, 'secret-link.txt'),
            )
            await symlink(outsideDir, join(config.paths.workspaceDir, 'outside-link'))

            await expect(
                executeTool(config, 'agent_room_read', {
                    path: 'secret-link.txt',
                }),
            ).rejects.toThrow(/escapes allowed root/)
            await expect(
                executeTool(config, 'agent_room_write', {
                    path: 'outside-link/new.txt',
                    content: 'escape',
                }),
            ).rejects.toThrow(/escapes allowed root/)
            await expect(
                executeTool(config, 'agent_room_write', {
                    path: 'secret-link.txt',
                    content: 'overwrite escape',
                    overwrite: true,
                }),
            ).rejects.toThrow(/escapes allowed root/)
            await expect(
                executeDocumentTool(config, 'agent_room_pdf', {
                    operation: 'create',
                    path: 'outside-link/report.pdf',
                    title: 'Escape',
                    paragraphs: ['This should not be written outside the workspace.'],
                }),
            ).rejects.toThrow(/escapes allowed root/)

            const list = await executeTool(config, 'agent_room_list', {
                path: '.',
            })
            expect(resultText(list.result)).toContain('link')
            expect(resultText(list.result)).toContain('outside-link')
        })
    })

    it('removes shell and mutation tool names when shell and coding capability is disabled', () => {
        const names = roomToolNamesForCapabilities('coworker', {
            ...testCapabilities,
            shellCoding: false,
        })

        expect(names).toContain('agent_room_read')
        expect(names).not.toContain('agent_room_shell')
        expect(names).not.toContain('agent_room_write')
        expect(names).not.toContain('agent_room_artifact_import')
    })

    it('keeps programmer mode focused on code tools without coworker artifacts', () => {
        const names = roomToolNamesForCapabilities('programmer', testCapabilities)

        expect(names).toContain('agent_room_read')
        expect(names).toContain('agent_room_write')
        expect(names).toContain('agent_room_shell')
        expect(names).not.toContain('agent_room_artifact_import')
        expect(names).not.toContain('agent_room_artifact_export')
    })

    it('keeps shell-writable tool files owner-only', async () => {
        await withRoom(async (config) => {
            await executeTool(config, 'agent_room_write', {
                path: 'notes.txt',
                content: 'secret',
            })

            expect((await stat(config.paths.workspaceDir)).mode & 0o777).toBe(0o700)
            expect((await stat(join(config.paths.workspaceDir, 'notes.txt'))).mode & 0o777).toBe(
                0o600,
            )
        })
    })

    it('reads, lists, searches, writes, and edits workspace files through room-owned tools', async () => {
        await withRoom(async (config) => {
            await executeTool(config, 'agent_room_write', {
                path: 'notes/example.txt',
                content: 'alpha\nbeta\n',
            })
            await executeTool(config, 'agent_room_edit', {
                path: 'notes/example.txt',
                oldText: 'beta',
                newText: 'gamma',
            })

            const read = await executeTool(config, 'agent_room_read', {
                path: 'notes/example.txt',
            })
            const list = await executeTool(config, 'agent_room_list', {
                path: 'notes',
            })
            const search = await executeTool(config, 'agent_room_search', {
                pattern: 'gamma',
                literal: true,
            })
            const editDetails = resultDetails(
                await executeTool(config, 'agent_room_edit', {
                    path: 'notes/example.txt',
                    oldText: 'gamma',
                    newText: 'delta',
                }).then((value) => value.result),
            )

            expect(read.result.content[0]?.type).toBe('text')
            expect(resultText(read.result)).toContain('gamma')
            expect(resultText(list.result)).toContain('example.txt')
            expect(resultText(search.result)).toContain('notes/example.txt:2:gamma')
            expect(editDetails.fileChange).toMatchObject({
                kind: 'edit',
                root: 'workspace',
            })
            expect(read.events.some((event) => event.event === 'tool.read')).toBe(true)
        })
    })

    it('fails closed for empty, oversized, and invalid search patterns', async () => {
        await withRoom(async (config) => {
            await writeFile(join(config.paths.workspaceDir, 'notes.txt'), 'alpha', 'utf8')

            await expect(
                executeTool(config, 'agent_room_search', {
                    pattern: '',
                }),
            ).rejects.toThrow('Search pattern cannot be empty')
            await expect(
                executeTool(config, 'agent_room_search', {
                    pattern: '[',
                }),
            ).rejects.toThrow('not a valid regular expression')
            await expect(
                executeTool(config, 'agent_room_search', {
                    pattern: 'a'.repeat(1001),
                }),
            ).rejects.toThrow('cannot exceed')
        })
    })

    it('runs shell commands with room cwd, bounded environment, and audit details', async () => {
        await withRoom(async (config) => {
            const previousSecret = process.env.OPENAI_API_KEY
            process.env.OPENAI_API_KEY = 'agent-room-secret'
            try {
                const shell = await executeTool(config, 'agent_room_shell', {
                    command: 'printf "%s|%s|%s" "$PWD" "$HOME" "$OPENAI_API_KEY"',
                    timeoutMs: 1000,
                })

                expect(resultText(shell.result)).toContain(config.paths.workspaceDir)
                expect(resultText(shell.result)).toContain(config.paths.homeDir)
                expect(resultText(shell.result)).not.toContain('agent-room-secret')
                expect(resultDetails(shell.result).exitCode).toBe(0)
                expect(shell.events.some((event) => event.event === 'tool.shell')).toBe(true)
            } finally {
                if (previousSecret === undefined) {
                    delete process.env.OPENAI_API_KEY
                } else {
                    process.env.OPENAI_API_KEY = previousSecret
                }
            }
        })
    })

    it('keeps shell temp files under the room Pi state directory', async () => {
        await withRoom(async (config) => {
            const shell = await executeTool(config, 'agent_room_shell', {
                command:
                    'tmpfile="$TMPDIR/tool-temp.txt"; printf temp > "$tmpfile"; printf "%s" "$tmpfile"',
                timeoutMs: 1000,
            })

            expect(resultText(shell.result)).toContain(join(config.paths.tmpDir, 'tool-temp.txt'))
            await expect(
                readFile(join(config.paths.tmpDir, 'tool-temp.txt'), 'utf8'),
            ).resolves.toBe('temp')
        })
    })

    it('bounds shell output and supports timeout and cancellation', async () => {
        await withRoom(async (config) => {
            const bounded = await executeTool(config, 'agent_room_shell', {
                command: 'yes x | head -c 140000',
                timeoutMs: 2000,
            })
            const timedOut = await executeTool(config, 'agent_room_shell', {
                command: 'sleep 1',
                timeoutMs: 20,
            })
            const controller = new AbortController()
            setTimeout(() => controller.abort(), 20).unref()
            const cancelled = await executeTool(
                config,
                'agent_room_shell',
                {
                    command: 'sleep 1',
                    timeoutMs: 1000,
                },
                controller.signal,
            )

            expect(Buffer.byteLength(resultText(bounded.result))).toBeLessThanOrEqual(128000)
            expect(resultDetails(bounded.result).truncated).toBe(true)
            expect(resultDetails(timedOut.result).timedOut).toBe(true)
            expect(resultDetails(cancelled.result).aborted).toBe(true)
            expect(Number(resultDetails(cancelled.result).durationMs)).toBeLessThan(1000)
        })
    })

    it('uses the runtime run abort signal for shell cancellation', async () => {
        await withRoom(async (config) => {
            const controller = new AbortController()
            setTimeout(() => controller.abort(), 20).unref()
            const cancelled = await withToolRunContext(
                {
                    sessionKey: 'thread-1',
                    runId: 'run-1',
                    signal: controller.signal,
                },
                () =>
                    executeTool(config, 'agent_room_shell', {
                        command: 'sleep 1',
                        timeoutMs: 1000,
                    }),
            )

            expect(resultDetails(cancelled.result).aborted).toBe(true)
            expect(Number(resultDetails(cancelled.result).durationMs)).toBeLessThan(1000)
        })
    })

    it('places internal document preview work under the hidden temp path', async () => {
        await withRoom(async (config) => {
            const { writableInternalPreviewPath } = await import('./document-tools/paths')
            const previewPath = await writableInternalPreviewPath(
                config,
                'Quarterly Brief.docx',
                'png',
            )
            const tmpRoot = await realpath(config.paths.tmpDir)

            expect(previewPath.startsWith(join(tmpRoot, 'previews'))).toBe(true)
            expect(previewPath.startsWith(config.paths.workspaceDir)).toBe(false)
            expect(previewPath.startsWith(config.paths.storeDir)).toBe(false)
        })
    })

    it('lets PDF tools inspect store-backed uploaded files without mutating them', async () => {
        await withRoom(async (config) => {
            await mkdir(join(config.paths.storeDir, 'attachments/session'), {
                recursive: true,
            })
            await executeDocumentTool(config, 'agent_room_pdf', {
                operation: 'create',
                path: 'source.pdf',
                paragraphs: ['Uploaded PDF text'],
            })
            await executeDocumentTool(config, 'agent_room_pdf', {
                operation: 'edit',
                path: 'source.pdf',
                editsJson: JSON.stringify([
                    {
                        type: 'append_text_page',
                        title: 'Appendix',
                        paragraphs: ['Added directly to the PDF'],
                    },
                ]),
            })
            const editedPdf = await PDFDocument.load(
                await readFile(join(config.paths.workspaceDir, 'source.pdf')),
            )
            await copyFile(
                join(config.paths.workspaceDir, 'source.pdf'),
                join(config.paths.storeDir, 'attachments/session/source.pdf'),
            )
            const inspectedPdf = await executeDocumentTool(config, 'agent_room_pdf', {
                operation: 'inspect',
                root: 'store',
                path: 'attachments/session/source.pdf',
            })

            expect(editedPdf.getPageCount()).toBe(2)
            expect(resultText(inspectedPdf.result)).toContain('PDF file')
            expect(resultDetails(inspectedPdf.result)).toMatchObject({
                root: 'store',
                format: 'pdf',
            })
        })
    })

    it('does not expose office or text-extraction document compatibility tools', async () => {
        await withRoom(async (config) => {
            const names = createDocumentTools({ config, audit: async () => {} }).map(
                (tool) => tool.name,
            )

            expect(names).toContain('agent_room_read_pdf')
            expect(names).toContain('agent_room_pdf')
            expect(names).not.toContain('agent_room_docx')
            expect(names).not.toContain('agent_room_xlsx')
            expect(names).not.toContain('agent_room_pptx')
            expect(names).not.toContain('agent_room_pdf_extract_text')
        })
    })

    it('reads PDFs through native document mode and keeps text extraction explicit', async () => {
        await withRoom(async (config) => {
            await executeDocumentTool(config, 'agent_room_pdf', {
                operation: 'create',
                path: 'source.pdf',
                paragraphs: ['Native PDF path text'],
            })

            const readPdf = await executeDocumentTool(
                config,
                'agent_room_read_pdf',
                {
                    path: 'source.pdf',
                },
                undefined,
                {
                    model: anthropicModel(),
                },
            )

            expect(resultText(readPdf.result)).toContain('native document input')
            expect(readPdf.result.content[1]).toMatchObject({
                type: 'image',
                mimeType: 'application/pdf',
            })
            expect(resultDetails(readPdf.result)).toMatchObject({
                ingestionMode: 'native_document',
                backend: 'anthropic_native_document',
            })
        })
    })

    it('does not route PDFs through stale Anthropic config after the active model changes', async () => {
        await withRoom(async (config) => {
            config.provider.sourceProvider = 'anthropic'
            config.provider.api = 'anthropic-messages'
            config.provider.piProvider = 'anthropic'
            await executeDocumentTool(config, 'agent_room_pdf', {
                operation: 'create',
                path: 'source.pdf',
                paragraphs: ['Stale provider text'],
            })

            const readPdf = await executeDocumentTool(
                config,
                'agent_room_read_pdf',
                {
                    path: 'source.pdf',
                },
                undefined,
                {
                    model: model(['text'], {
                        id: 'gpt-text-only',
                        provider: 'openai',
                        api: 'openai-responses',
                    }),
                },
            )

            expect(resultText(readPdf.result)).toContain('unsupported')
            expect(readPdf.result.content).toHaveLength(1)
            expect(resultDetails(readPdf.result)).toMatchObject({
                ingestionMode: 'unsupported',
                backend: 'unsupported',
                inputBlocks: 0,
                degraded: true,
            })
        })
    })

    it('discloses that native PDF page selections do not crop document bytes', async () => {
        await withRoom(async (config) => {
            await writePdfFixture(join(config.paths.workspaceDir, 'multi.pdf'), 2)

            const readPdf = await executeDocumentTool(
                config,
                'agent_room_read_pdf',
                {
                    path: 'multi.pdf',
                    pages: '1',
                },
                undefined,
                {
                    model: anthropicModel(),
                },
            )

            expect(resultText(readPdf.result)).toContain('native document input')
            expect(resultText(readPdf.result)).toContain('native document input sends the full PDF')
            expect(readPdf.result.content[1]).toMatchObject({
                type: 'image',
                mimeType: 'application/pdf',
            })
            expect(resultDetails(readPdf.result)).toMatchObject({
                ingestionMode: 'native_document',
                backend: 'anthropic_native_document',
                pages: 'all pages',
                requestedPages: 'pages 1',
                degraded: true,
            })
        })
    })

    it('reports unsupported PDF reads without falling back to text extraction silently', async () => {
        await withRoom(async (config) => {
            await executeDocumentTool(config, 'agent_room_pdf', {
                operation: 'create',
                path: 'source.pdf',
                paragraphs: ['Unsupported PDF path text'],
            })

            const readPdf = await executeDocumentTool(config, 'agent_room_read_pdf', {
                path: 'source.pdf',
            })

            expect(resultText(readPdf.result)).toContain('unsupported')
            expect(readPdf.result.content).toHaveLength(1)
            expect(resultDetails(readPdf.result)).toMatchObject({
                ingestionMode: 'unsupported',
                backend: 'unsupported',
                inputBlocks: 0,
                degraded: true,
            })
        })
    })

    it('imports and exports artifacts through the room store', async () => {
        await withRoom(async (config) => {
            await writeFile(join(config.paths.workspaceDir, 'report.txt'), 'artifact body', 'utf8')
            const imported = await withToolRunContext(
                {
                    sessionKey: 'thread-1',
                    runId: 'run-1',
                    signal: new AbortController().signal,
                },
                () =>
                    executeTool(config, 'agent_room_artifact_import', {
                        path: 'report.txt',
                        mediaType: 'text/plain',
                    }),
            )
            const artifact = JSON.parse(resultText(imported.result) || '{}') as {
                artifactId: string
            }
            const manifest = JSON.parse(
                await readFile(
                    join(config.paths.storeDir, 'manifests', `${artifact.artifactId}.json`),
                    'utf8',
                ),
            ) as Record<string, unknown>

            await executeTool(config, 'agent_room_artifact_export', {
                artifactId: artifact.artifactId,
                path: 'exports/report-copy.txt',
            })

            expect(manifest).toMatchObject({
                sourcePath: 'report.txt',
                mediaType: 'text/plain',
                sessionKey: 'thread-1',
                runId: 'run-1',
            })
            await expect(
                readFile(join(config.paths.workspaceDir, 'exports/report-copy.txt'), 'utf8'),
            ).resolves.toBe('artifact body')
        })
    })
})
