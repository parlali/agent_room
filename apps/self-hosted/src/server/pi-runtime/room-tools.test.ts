import { copyFile, mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createGrepTool } from '@mariozechner/pi-coding-agent'
import { describe, expect, it } from 'vitest'
import { PDFDocument } from 'pdf-lib'
import type { PiRuntimeConfig } from '../rooms/pi-runtime-config'
import {
    createRoomTools,
    nativeWorkspaceToolNamesForCapabilities,
    roomToolNamesForCapabilities,
} from './room-tools'
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

async function executeRoomTool(
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

function resultText(result: Awaited<ReturnType<typeof executeRoomTool>>['result']): string {
    const part = result.content[0]
    return part && 'text' in part && typeof part.text === 'string' ? part.text : ''
}

function resultDetails(result: Awaited<ReturnType<typeof executeRoomTool>>['result']) {
    return typeof result.details === 'object' && result.details !== null
        ? (result.details as Record<string, unknown>)
        : {}
}

describe('room Pi tools', () => {
    it('uses Pi-native workspace tool names and keeps custom tools product-neutral', () => {
        expect(nativeWorkspaceToolNamesForCapabilities(testCapabilities)).toEqual([
            'read',
            'grep',
            'find',
            'ls',
            'edit',
            'write',
        ])
        expect(
            nativeWorkspaceToolNamesForCapabilities({
                ...testCapabilities,
                shellCoding: false,
            }),
        ).toEqual(['read', 'grep', 'find', 'ls'])

        const coworkerNames = roomToolNamesForCapabilities('coworker', testCapabilities)
        const programmerNames = roomToolNamesForCapabilities('programmer', testCapabilities)

        expect(coworkerNames).toEqual([
            'skill_list',
            'skill_read',
            'skill_search',
            'shell',
            'command_start',
            'command_poll',
            'command_status',
            'command_terminate',
            'artifact_import',
            'artifact_export',
        ])
        expect(programmerNames).not.toContain('artifact_import')
        expect(
            [...coworkerNames, ...programmerNames].some((name) => name.startsWith('agent_room_')),
        ).toBe(false)
    })

    it('removes shell and artifact tool names when shell coding is disabled', () => {
        const names = roomToolNamesForCapabilities('coworker', {
            ...testCapabilities,
            shellCoding: false,
        })

        expect(names).toEqual(['skill_list', 'skill_read', 'skill_search'])
    })

    it('does not register duplicate Agent Room workspace tools', async () => {
        await withRoom(async (config) => {
            const names = createRoomTools({ config, audit: async () => {} }).map(
                (tool) => tool.name,
            )

            expect(names).not.toContain('agent_room_read')
            expect(names).not.toContain('agent_room_list')
            expect(names).not.toContain('agent_room_search')
            expect(names).not.toContain('agent_room_workspace_tree')
            expect(names).not.toContain('agent_room_write')
            expect(names).not.toContain('agent_room_edit')
            expect(names).toContain('skill_read')
            expect(names).toContain('shell')
            expect(names).toContain('artifact_import')
        })
    })

    it('reads and searches bundled skills through the read-only skill tools', async () => {
        await withRoom(async (config) => {
            const listed = await executeRoomTool(config, 'skill_list', {
                path: 'docx',
            })
            const read = await executeRoomTool(config, 'skill_read', {
                path: 'docx/SKILL.md',
            })
            const searched = await executeRoomTool(config, 'skill_search', {
                path: 'docx',
                query: 'signatureGrid',
            })

            expect(resultText(listed.result)).toContain('file\tdocx/SKILL.md')
            expect(resultText(read.result)).toContain('# DOCX')
            expect(resultText(searched.result)).toContain('docx/SKILL.md')
            expect(resultText(searched.result)).toContain('signatureGrid')
            expect(resultDetails(read.result)).toMatchObject({
                root: 'skills',
                path: 'docx/SKILL.md',
            })
            expect(read.events.some((event) => event.event === 'tool.skill_read')).toBe(true)
        })
    })

    it('keeps bundled skill tools inside the skill asset root', async () => {
        await withRoom(async (config) => {
            await expect(
                executeRoomTool(config, 'skill_read', {
                    path: '/app/src/server/pi-runtime/skills/docx/SKILL.md',
                }),
            ).rejects.toThrow(/relative/)
            await expect(
                executeRoomTool(config, 'skill_read', {
                    path: '../src/server/pi-runtime/skills/docx/SKILL.md',
                }),
            ).rejects.toThrow(/escapes bundled skills/)
        })
    })

    it('uses Pi grep behavior for ignore-aware bounded workspace search', async () => {
        await withRoom(async (config) => {
            await writeFile(join(config.paths.workspaceDir, '.gitignore'), 'vendor/\n', 'utf8')
            await writeFile(join(config.paths.workspaceDir, '.ignore'), 'vendor/\n', 'utf8')
            await mkdir(join(config.paths.workspaceDir, 'src'), {
                recursive: true,
            })
            await mkdir(join(config.paths.workspaceDir, 'vendor'), {
                recursive: true,
            })
            await writeFile(
                join(config.paths.workspaceDir, 'src', 'match.txt'),
                `MATCH ${'x'.repeat(12000)}\nMATCH second\n`,
                'utf8',
            )
            await writeFile(
                join(config.paths.workspaceDir, 'vendor', 'ignored.txt'),
                'MATCH ignored\n',
                'utf8',
            )

            const grep = createGrepTool(config.paths.workspaceDir)
            const result = await grep.execute(
                'call-1',
                {
                    pattern: 'MATCH',
                    literal: true,
                    limit: 1,
                },
                undefined,
                undefined,
            )
            const text = resultText(result)

            expect(text).toContain('src/match.txt:1:')
            expect(text).not.toContain('ignored.txt')
            expect(text).toContain('1 matches limit reached')
            expect(text).toContain('Some lines truncated')
            expect(Buffer.byteLength(text)).toBeLessThan(60_000)
        })
    })

    it('runs shell commands with workspace cwd, bounded environment, and audit details', async () => {
        await withRoom(async (config) => {
            const previousSecret = process.env.ROOM_HOST_SECRET
            process.env.ROOM_HOST_SECRET = 'agent-room-secret'
            try {
                const shell = await executeRoomTool(config, 'shell', {
                    command:
                        'printf "pwd=%s\\nhome=%s\\nworkspace=%s\\nstore=%s\\nold_workspace=%s\\nold_store=%s\\nsecret=%s\\n" "$PWD" "$HOME" "$WORKSPACE_DIR" "$STORE_DIR" "$AGENT_ROOM_WORKSPACE_DIR" "$AGENT_ROOM_STORE_DIR" "$ROOM_HOST_SECRET"',
                    timeoutMs: 1000,
                })

                const text = resultText(shell.result)
                const realWorkspaceDir = await realpath(config.paths.workspaceDir)

                expect(text).toContain(`pwd=${realWorkspaceDir}`)
                expect(text).toContain(`home=${config.paths.homeDir}`)
                expect(text).toContain(`workspace=${config.paths.workspaceDir}`)
                expect(text).toContain(`store=${config.paths.storeDir}`)
                expect(text).toContain('old_workspace=\n')
                expect(text).toContain('old_store=\n')
                expect(text).not.toContain('agent-room-secret')
                expect(text).not.toContain(config.runtime.roomId)
                expect(resultDetails(shell.result).exitCode).toBe(0)
                expect(resultDetails(shell.result).sandboxMode).toBe('test-unsafe')
                expect(shell.events.some((event) => event.event === 'tool.shell')).toBe(true)
            } finally {
                if (previousSecret === undefined) {
                    delete process.env.ROOM_HOST_SECRET
                } else {
                    process.env.ROOM_HOST_SECRET = previousSecret
                }
            }
        })
    })

    it('keeps shell temp files under the Pi state directory', async () => {
        await withRoom(async (config) => {
            const shell = await executeRoomTool(config, 'shell', {
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
            const bounded = await executeRoomTool(config, 'shell', {
                command: 'yes x | head -c 140000',
                timeoutMs: 2000,
            })
            const timedOut = await executeRoomTool(config, 'shell', {
                command: 'sleep 1',
                timeoutMs: 20,
            })
            const controller = new AbortController()
            setTimeout(() => controller.abort(), 20).unref()
            const cancelled = await executeRoomTool(
                config,
                'shell',
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
                    executeRoomTool(config, 'shell', {
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

    it('keeps writable helper outputs owner-only in test-unsafe mode', async () => {
        await withRoom(async (config) => {
            await executeDocumentTool(config, 'pdf', {
                operation: 'create',
                path: 'notes.pdf',
                paragraphs: ['secret'],
            })

            expect((await stat(config.paths.workspaceDir)).mode & 0o777).toBe(0o700)
            expect((await stat(join(config.paths.workspaceDir, 'notes.pdf'))).mode & 0o777).toBe(
                0o600,
            )
        })
    })

    it('lets PDF tools inspect store-backed uploaded files without mutating them', async () => {
        await withRoom(async (config) => {
            await mkdir(join(config.paths.storeDir, 'attachments/session'), {
                recursive: true,
            })
            await executeDocumentTool(config, 'pdf', {
                operation: 'create',
                path: 'source.pdf',
                paragraphs: ['Uploaded PDF text'],
            })
            await executeDocumentTool(config, 'pdf', {
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
            const inspectedPdf = await executeDocumentTool(config, 'pdf', {
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

    it('exposes simplified PDF tools without office compatibility tools', async () => {
        await withRoom(async (config) => {
            const names = createDocumentTools({ config, audit: async () => {} }).map(
                (tool) => tool.name,
            )

            expect(names).toContain('read_pdf')
            expect(names).toContain('pdf')
            expect(names.some((name) => name.startsWith('agent_room_'))).toBe(false)
            expect(names).not.toContain('docx')
            expect(names).not.toContain('xlsx')
            expect(names).not.toContain('pptx')
            expect(names).not.toContain('pdf_extract_text')
        })
    })

    it('reports unsupported PDF reads without falling back to text extraction silently', async () => {
        await withRoom(async (config) => {
            await executeDocumentTool(config, 'pdf', {
                operation: 'create',
                path: 'source.pdf',
                paragraphs: ['Unsupported PDF path text'],
            })

            const readPdf = await executeDocumentTool(config, 'read_pdf', {
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

    it('imports and exports artifacts through the store', async () => {
        await withRoom(async (config) => {
            await writeFile(join(config.paths.workspaceDir, 'report.txt'), 'artifact body', 'utf8')
            const imported = await withToolRunContext(
                {
                    sessionKey: 'thread-1',
                    runId: 'run-1',
                    signal: new AbortController().signal,
                },
                () =>
                    executeRoomTool(config, 'artifact_import', {
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

            await executeRoomTool(config, 'artifact_export', {
                artifactId: artifact.artifactId,
                path: 'exports/report-copy.txt',
            })

            expect(manifest).toMatchObject({
                sourcePath: 'report.txt',
                mediaType: 'text/plain',
            })
            expect(manifest).not.toHaveProperty('sessionKey')
            expect(manifest).not.toHaveProperty('runId')
            await expect(
                readFile(join(config.paths.workspaceDir, 'exports/report-copy.txt'), 'utf8'),
            ).resolves.toBe('artifact body')
        })
    })
})
