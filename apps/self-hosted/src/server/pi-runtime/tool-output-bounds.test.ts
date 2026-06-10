import { mkdtemp, readFile, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createTestPiRuntimeConfig, ensureTestPiRuntimeDirectories } from './test-runtime-defaults'
import { boundToolOutput, modelVisibleToolOutputMaxBytes } from './tool-output-bounds'
import { withToolRunContext } from './tool-run-context'

describe('tool output bounds', () => {
    it('keeps small output inline', async () => {
        const root = await mkdtemp(join(tmpdir(), 'agent-room-tool-output-'))
        const config = createTestPiRuntimeConfig({ root })
        await ensureTestPiRuntimeDirectories(config)

        await expect(
            boundToolOutput({
                config,
                text: 'small output',
                label: 'fetch',
            }),
        ).resolves.toEqual({
            text: 'small output',
            modelVisibleTruncated: false,
            outputArtifact: null,
        })
    })

    it('truncates large model-visible output and saves the full body', async () => {
        const root = await mkdtemp(join(tmpdir(), 'agent-room-tool-output-'))
        const config = createTestPiRuntimeConfig({ root })
        await ensureTestPiRuntimeDirectories(config)
        const controller = new AbortController()
        const text = `${'a'.repeat(modelVisibleToolOutputMaxBytes)}${'b'.repeat(1000)}`
        const previousUnsandboxedShell = process.env.AGENT_ROOM_UNSAFE_ALLOW_UNSANDBOXED_SHELL
        process.env.AGENT_ROOM_UNSAFE_ALLOW_UNSANDBOXED_SHELL = '1'

        try {
            const result = await withToolRunContext(
                {
                    sessionKey: 'session-1',
                    runId: 'run-1',
                    signal: controller.signal,
                },
                () =>
                    boundToolOutput({
                        config,
                        text,
                        label: 'fetch-large-json',
                        extension: 'txt',
                    }),
            )

            expect(result.modelVisibleTruncated).toBe(true)
            expect(result.text).toContain('[Tool output truncated for model context]')
            expect(result.text.length).toBeLessThan(text.length)
            expect(result.outputArtifact).toMatchObject({
                root: 'store',
                byteLength: Buffer.byteLength(text),
                modelVisibleByteLength: modelVisibleToolOutputMaxBytes,
            })
            expect(result.outputArtifact?.path).toMatch(/^tool-output\//)
            expect(result.outputArtifact?.path).not.toContain('session-1')
            expect(result.outputArtifact?.path).not.toContain('run-1')
            const savedPath = join(config.paths.storeDir, result.outputArtifact!.path)
            await expect(readFile(savedPath, 'utf8')).resolves.toBe(text)
            const savedStat = await stat(savedPath)
            expect(savedStat.mode & 0o777).toBe(0o600)
        } finally {
            if (previousUnsandboxedShell === undefined) {
                delete process.env.AGENT_ROOM_UNSAFE_ALLOW_UNSANDBOXED_SHELL
            } else {
                process.env.AGENT_ROOM_UNSAFE_ALLOW_UNSANDBOXED_SHELL = previousUnsandboxedShell
            }
        }
    })
})
