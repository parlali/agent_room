import { mkdtemp, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
    cleanupBackgroundCommands,
    getBackgroundCommand,
    startBackgroundCommand,
    terminateBackgroundCommand,
} from './background-commands'
import { testBudgets, testCapabilities, testImage, testSearch } from './test-runtime-defaults'
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
    const stateDir = join(root, 'state')
    const workspaceDir = join(root, 'workspace')
    const storeDir = join(root, 'store')
    const sessionsDir = join(root, 'sessions')
    const internalStateDir = join(stateDir, 'internal-state')
    const homeDir = join(root, 'home')
    const tmpDir = join(root, 'tmp')
    await Promise.all([
        mkdir(stateDir, { recursive: true }),
        mkdir(workspaceDir, { recursive: true }),
        mkdir(storeDir, { recursive: true }),
        mkdir(sessionsDir, { recursive: true }),
        mkdir(internalStateDir, { recursive: true }),
        mkdir(homeDir, { recursive: true }),
        mkdir(tmpDir, { recursive: true }),
    ])
    return {
        runtime: {
            kind: 'pi',
            roomId: 'room-test',
            displayName: 'Test Room',
            bindHost: '127.0.0.1',
            port: 0,
            token: 'token',
        },
        paths: {
            roomRootDir: root,
            stateDir,
            workspaceDir,
            storeDir,
            sessionsDir,
            internalStateDir,
            authPath: join(stateDir, 'auth.json'),
            modelsPath: join(stateDir, 'models.json'),
            threadIndexPath: join(stateDir, 'threads.json'),
            runtimeEventsPath: join(stateDir, 'events.jsonl'),
            homeDir,
            tmpDir,
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
            fallbackModels: [],
        },
        tools: {
            profile: 'coding',
        },
        capabilities: testCapabilities,
        search: testSearch,
        image: testImage,
        budgets: testBudgets,
        instructions: '',
        mcpServers: [],
        models: {
            providers: {},
        },
        compaction: {
            enabled: true,
            reserveTokens: 4000,
            keepRecentTokens: 12000,
        },
    }
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
