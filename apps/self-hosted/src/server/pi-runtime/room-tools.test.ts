import { copyFile, mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import { PDFDocument } from 'pdf-lib'
import type { PiRuntimeConfig } from '../rooms/pi-runtime-config'
import { createNativeWorkspaceTools } from './native-workspace-tools'
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
    it('keeps exported tool-name contracts aligned with registered tools', async () => {
        await withRoom(async (config) => {
            const disabledShellConfig: PiRuntimeConfig = {
                ...config,
                capabilities: {
                    ...config.capabilities,
                    shellCoding: false,
                },
            }
            const programmerConfig: PiRuntimeConfig = {
                ...config,
                roomMode: 'programmer',
            }

            expect(
                createNativeWorkspaceTools({ config, audit: async () => {} }).map(
                    (tool) => tool.name,
                ),
            ).toEqual(nativeWorkspaceToolNamesForCapabilities(config.capabilities))
            expect(
                createNativeWorkspaceTools({
                    config: disabledShellConfig,
                    audit: async () => {},
                }).map((tool) => tool.name),
            ).toEqual(nativeWorkspaceToolNamesForCapabilities(disabledShellConfig.capabilities))
            expect(
                createRoomTools({ config, audit: async () => {} }).map((tool) => tool.name),
            ).toEqual(roomToolNamesForCapabilities(config.roomMode, config.capabilities))
            expect(
                createRoomTools({ config: programmerConfig, audit: async () => {} }).map(
                    (tool) => tool.name,
                ),
            ).toEqual(
                roomToolNamesForCapabilities(
                    programmerConfig.roomMode,
                    programmerConfig.capabilities,
                ),
            )
            expect(
                createRoomTools({ config: disabledShellConfig, audit: async () => {} }).map(
                    (tool) => tool.name,
                ),
            ).toEqual(
                roomToolNamesForCapabilities(
                    disabledShellConfig.roomMode,
                    disabledShellConfig.capabilities,
                ),
            )
        })
    })

    it('removes shell and artifact tool names when shell coding is disabled', () => {
        const names = roomToolNamesForCapabilities('coworker', {
            ...testCapabilities,
            shellCoding: false,
        })

        expect(names).toEqual(['skill_list', 'skill_read', 'skill_search'])
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

    it('reports unsupported PDF reads without silently falling back to text extraction', async () => {
        await withRoom(async (config) => {
            await executeDocumentTool(config, 'pdf', {
                operation: 'create',
                path: 'source.pdf',
                paragraphs: ['Unsupported PDF path text'],
            })

            const readPdf = await executeDocumentTool(
                config,
                'read_pdf',
                {
                    path: 'source.pdf',
                },
                undefined,
                {
                    model: {
                        input: ['text'],
                    },
                },
            )

            expect(resultText(readPdf.result)).toContain('unsupported')
            expect(resultText(readPdf.result)).toContain(
                'Degraded: PDF reading requires a vision-capable model for rendered pages.',
            )
            expect(readPdf.result.content).toHaveLength(1)
            expect(resultDetails(readPdf.result)).toMatchObject({
                ingestionMode: 'unsupported',
                backend: 'unsupported',
                inputBlocks: 0,
                degraded: true,
                degradedReason: 'PDF reading requires a vision-capable model for rendered pages.',
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
