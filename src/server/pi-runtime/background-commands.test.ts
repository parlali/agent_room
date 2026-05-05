import { mkdtemp } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
    cleanupBackgroundCommands,
    getBackgroundCommand,
    startBackgroundCommand,
    terminateBackgroundCommand,
} from './background-commands'
import { createTestPiRuntimeConfig, ensureTestPiRuntimeDirectories } from './test-runtime-defaults'
import type { PiRuntimeConfig } from '../rooms/pi-runtime-config'

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

async function testConfig(): Promise<PiRuntimeConfig> {
    const root = await mkdtemp(join(tmpdir(), 'agent-room-command-test-'))
    const config = createTestPiRuntimeConfig({
        root,
        runtime: {
            roomId: 'room-test',
            displayName: 'Test Room',
            port: 0,
            token: 'token',
        },
        provider: {
            sourceProvider: 'openai',
            sourceModel: 'gpt-5.4-mini',
            piProvider: 'openai',
            piModel: 'gpt-5.4-mini',
            api: 'openai-responses',
            authMode: 'api_key',
            baseUrl: null,
            envKey: null,
            kind: 'builtin',
        },
        compaction: {
            reserveTokens: 4000,
            keepRecentTokens: 12000,
        },
    })
    await ensureTestPiRuntimeDirectories(config)
    return config
}

async function waitForCommand(config: PiRuntimeConfig, commandId: string) {
    for (let attempt = 0; attempt < 30; attempt += 1) {
        const record = await getBackgroundCommand({ config, commandId })
        if (record && record.status !== 'running') {
            return record
        }
        await new Promise((resolve) => setTimeout(resolve, 50))
    }
    throw new Error(`Command ${commandId} did not finish`)
}

describe('background commands', () => {
    it('starts commands, captures output, and persists exit code', async () => {
        const config = await testConfig()
        const started = await startBackgroundCommand({
            config,
            command: 'printf hello',
            timeoutMs: 5000,
            sessionKey: 'main',
            runId: 'run-1',
        })
        const finished = await waitForCommand(config, started.commandId)

        expect(finished.status).toBe('exited')
        expect(finished.exitCode).toBe(0)
        expect(finished.output).toBe('hello')
        expect(finished.command).toBe('[command redacted]')
        expect(finished.cwd).toBe(config.paths.workspaceDir)
        expect(finished.roomId).toBe('room-test')
    })

    it('terminates running commands by id and cleans up on shutdown', async () => {
        const config = await testConfig()
        const started = await startBackgroundCommand({
            config,
            command: 'sleep 5',
            timeoutMs: 5000,
        })
        const terminated = await terminateBackgroundCommand({
            config,
            commandId: started.commandId,
        })

        expect(terminated.status).toBe('terminated')
        expect(terminated.signal).toBe('manual')
        await cleanupBackgroundCommands(config)
    })
})
