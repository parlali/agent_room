import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createTestPiRuntimeConfig, ensureTestPiRuntimeDirectories } from '../test-runtime-defaults'
import { runDocumentWorker } from './worker'

let previousUnsandboxedShell: string | undefined

beforeEach(() => {
    previousUnsandboxedShell = process.env.AGENT_ROOM_UNSAFE_ALLOW_UNSANDBOXED_SHELL
    process.env.AGENT_ROOM_UNSAFE_ALLOW_UNSANDBOXED_SHELL = '1'
})

afterEach(() => {
    if (previousUnsandboxedShell === undefined) {
        delete process.env.AGENT_ROOM_UNSAFE_ALLOW_UNSANDBOXED_SHELL
    } else {
        process.env.AGENT_ROOM_UNSAFE_ALLOW_UNSANDBOXED_SHELL = previousUnsandboxedShell
    }
})

describe('document worker', () => {
    it('passes neutral path env names to worker processes', async () => {
        const root = await mkdtemp(join(tmpdir(), 'agent-room-document-worker-'))
        try {
            const config = createTestPiRuntimeConfig({ root })
            await ensureTestPiRuntimeDirectories(config)
            const output = await runDocumentWorker({
                config,
                command: '/bin/sh',
                args: [
                    '-c',
                    'printf "workspace=%s\\nstore=%s\\nold_workspace=%s\\nold_store=%s\\n" "$WORKSPACE_DIR" "$STORE_DIR" "$AGENT_ROOM_WORKSPACE_DIR" "$AGENT_ROOM_STORE_DIR"',
                ],
                cwd: config.paths.workspaceDir,
                timeoutMs: 1000,
            })

            expect(output).toContain(`workspace=${config.paths.workspaceDir}`)
            expect(output).toContain(`store=${config.paths.storeDir}`)
            expect(output).toContain('old_workspace=\n')
            expect(output).toContain('old_store=\n')
            expect(output).not.toContain(config.runtime.roomId)
        } finally {
            await rm(root, {
                recursive: true,
                force: true,
            })
        }
    })
})
