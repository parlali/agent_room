import { randomUUID } from 'node:crypto'
import { spawn, type ChildProcess } from 'node:child_process'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { PiRuntimeConfig } from '../rooms/pi-runtime-config'
import { buildBoundedProcessEnv } from '../security/process-env'
import {
    currentShellSandboxIdentity,
    ensureShellWritableDirectory,
    shellSandboxShellCommand,
} from './shell-sandbox'
import { combineAbortSignals, currentToolRunSignal } from './tool-run-context'

export type BackgroundCommandStatus = 'running' | 'exited' | 'terminated' | 'failed'

export interface BackgroundCommandRecord {
    commandId: string
    roomId: string
    sessionKey: string | null
    runId: string | null
    command: string
    cwd: string
    status: BackgroundCommandStatus
    startedAt: string
    lastOutputAt: string | null
    finishedAt: string | null
    exitCode: number | null
    signal: string | null
    output: string
    outputByteLength: number
    outputTruncated: boolean
    timeoutMs: number
}

interface RunningCommand {
    process: ChildProcess
    record: BackgroundCommandRecord
    timer: ReturnType<typeof setTimeout>
}

export const backgroundCommandMaxOutputBytes = 128000
const stateVersion = 1
const runningCommands = new Map<string, RunningCommand>()
const redactedCommandText = '[command redacted]'

function statePath(config: PiRuntimeConfig): string {
    return join(config.paths.internalStateDir, 'commands.json')
}

function nowIso(): string {
    return new Date().toISOString()
}

function commandEnv(config: PiRuntimeConfig): NodeJS.ProcessEnv {
    return buildBoundedProcessEnv({
        HOME: config.paths.homeDir,
        TMPDIR: config.paths.tmpDir,
        AGENT_ROOM_WORKSPACE_DIR: config.paths.workspaceDir,
        AGENT_ROOM_STORE_DIR: config.paths.storeDir,
    })
}

function boundOutput(
    previous: string,
    chunk: Buffer,
    redactOutput?: (value: string) => string,
): {
    output: string
    truncated: boolean
} {
    const next = redactOutput
        ? redactOutput(previous + chunk.toString('utf8'))
        : previous + chunk.toString('utf8')
    const bytes = Buffer.from(next)
    if (bytes.byteLength <= backgroundCommandMaxOutputBytes) {
        return {
            output: next,
            truncated: false,
        }
    }
    return {
        output: bytes.subarray(bytes.byteLength - backgroundCommandMaxOutputBytes).toString('utf8'),
        truncated: true,
    }
}

async function readRecords(config: PiRuntimeConfig): Promise<BackgroundCommandRecord[]> {
    try {
        const raw = JSON.parse(await readFile(statePath(config), 'utf8')) as {
            version?: number
            commands?: BackgroundCommandRecord[]
        }
        if (raw.version !== stateVersion || !Array.isArray(raw.commands)) {
            return []
        }
        return raw.commands
    } catch {
        return []
    }
}

async function writeRecords(
    config: PiRuntimeConfig,
    commands: BackgroundCommandRecord[],
): Promise<void> {
    const path = statePath(config)
    await mkdir(dirname(path), {
        recursive: true,
        mode: 0o700,
    })
    const tempPath = `${path}.${process.pid}.${Date.now()}.${randomUUID()}.tmp`
    await writeFile(
        tempPath,
        JSON.stringify(
            {
                version: stateVersion,
                commands: commands.slice(-100),
            },
            null,
            4,
        ),
        {
            encoding: 'utf8',
            mode: 0o600,
        },
    )
    await rename(tempPath, path)
}

async function persistRecord(config: PiRuntimeConfig, record: BackgroundCommandRecord) {
    const records = await readRecords(config)
    const next = records.filter((entry) => entry.commandId !== record.commandId)
    next.push(record)
    await writeRecords(config, next)
}

function terminateProcess(child: ChildProcess, signal: NodeJS.Signals) {
    if (child.pid) {
        try {
            process.kill(-child.pid, signal)
            return
        } catch {}
    }
    child.kill(signal)
}

function terminateWithEscalation(child: ChildProcess, signal: NodeJS.Signals) {
    terminateProcess(child, signal)
    setTimeout(() => {
        if (child.exitCode === null && child.signalCode === null) {
            terminateProcess(child, 'SIGKILL')
        }
    }, 2000).unref()
}

export async function startBackgroundCommand(input: {
    config: PiRuntimeConfig
    command: string
    timeoutMs: number
    sessionKey?: string | null
    runId?: string | null
    signal?: AbortSignal
    redactOutput?: (value: string) => string
    onOutput?: (record: BackgroundCommandRecord) => void
}): Promise<BackgroundCommandRecord> {
    const command = input.command.trim()
    if (!command) {
        throw new Error('Command cannot be empty')
    }

    await ensureShellWritableDirectory(input.config, input.config.paths.workspaceDir)
    const combined = combineAbortSignals([input.signal, currentToolRunSignal()])
    const record: BackgroundCommandRecord = {
        commandId: randomUUID(),
        roomId: input.config.runtime.roomId,
        sessionKey: input.sessionKey ?? null,
        runId: input.runId ?? null,
        command: redactedCommandText,
        cwd: input.config.paths.workspaceDir,
        status: 'running',
        startedAt: nowIso(),
        lastOutputAt: null,
        finishedAt: null,
        exitCode: null,
        signal: null,
        output: '',
        outputByteLength: 0,
        outputTruncated: false,
        timeoutMs: input.timeoutMs,
    }

    const sandboxedCommand = shellSandboxShellCommand(input.config, command)
    const child = spawn(sandboxedCommand.command, sandboxedCommand.args, {
        cwd: record.cwd,
        env: commandEnv(input.config),
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: true,
    })

    const append = (chunk: Buffer) => {
        const bounded = boundOutput(record.output, chunk, input.redactOutput)
        record.output = bounded.output
        record.outputTruncated = record.outputTruncated || bounded.truncated
        record.outputByteLength = Buffer.byteLength(record.output)
        record.lastOutputAt = nowIso()
        input.onOutput?.(record)
        void persistRecord(input.config, record)
    }

    child.stdout.on('data', append)
    child.stderr.on('data', append)

    const timer = setTimeout(() => {
        if (record.status !== 'running') {
            return
        }
        record.status = 'terminated'
        record.finishedAt = nowIso()
        record.signal = 'timeout'
        terminateWithEscalation(child, 'SIGTERM')
        void persistRecord(input.config, record)
    }, input.timeoutMs)
    timer.unref()

    const abort = () => {
        if (record.status !== 'running') {
            return
        }
        record.status = 'terminated'
        record.finishedAt = nowIso()
        record.signal = 'abort'
        terminateWithEscalation(child, 'SIGTERM')
        void persistRecord(input.config, record)
    }
    combined.signal?.addEventListener('abort', abort, { once: true })

    child.on('error', (error) => {
        record.status = 'failed'
        record.output = `${record.output}${record.output ? '\n' : ''}${error.message}`
        record.outputByteLength = Buffer.byteLength(record.output)
        record.finishedAt = nowIso()
        clearTimeout(timer)
        combined.dispose()
        runningCommands.delete(record.commandId)
        void persistRecord(input.config, record)
    })
    child.on('close', (exitCode, signal) => {
        if (record.status === 'running') {
            record.status = 'exited'
        }
        record.exitCode = exitCode
        record.signal = record.signal ?? signal
        record.finishedAt = record.finishedAt ?? nowIso()
        clearTimeout(timer)
        combined.dispose()
        runningCommands.delete(record.commandId)
        void persistRecord(input.config, record)
    })

    runningCommands.set(record.commandId, {
        process: child,
        record,
        timer,
    })
    await persistRecord(input.config, record)
    return record
}

export async function getBackgroundCommand(input: {
    config: PiRuntimeConfig
    commandId: string
}): Promise<BackgroundCommandRecord | null> {
    const running = runningCommands.get(input.commandId)
    if (running) {
        return running.record
    }
    const records = await readRecords(input.config)
    return records.find((record) => record.commandId === input.commandId) ?? null
}

export async function listBackgroundCommands(
    config: PiRuntimeConfig,
): Promise<BackgroundCommandRecord[]> {
    const persisted = await readRecords(config)
    const byId = new Map(persisted.map((record) => [record.commandId, record]))
    for (const running of runningCommands.values()) {
        byId.set(running.record.commandId, running.record)
    }
    return [...byId.values()].sort((left, right) => right.startedAt.localeCompare(left.startedAt))
}

export async function terminateBackgroundCommand(input: {
    config: PiRuntimeConfig
    commandId: string
}): Promise<BackgroundCommandRecord> {
    const running = runningCommands.get(input.commandId)
    if (!running) {
        const record = await getBackgroundCommand(input)
        if (!record) {
            throw new Error(`Command ${input.commandId} was not found`)
        }
        return record
    }
    running.record.status = 'terminated'
    running.record.signal = 'manual'
    running.record.finishedAt = nowIso()
    clearTimeout(running.timer)
    terminateWithEscalation(running.process, 'SIGTERM')
    await persistRecord(input.config, running.record)
    return running.record
}

export async function cleanupBackgroundCommands(config: PiRuntimeConfig): Promise<void> {
    for (const running of runningCommands.values()) {
        running.record.status = 'terminated'
        running.record.signal = 'runtime_shutdown'
        running.record.finishedAt = nowIso()
        clearTimeout(running.timer)
        terminateWithEscalation(running.process, 'SIGTERM')
        await persistRecord(config, running.record)
    }
    runningCommands.clear()
}

export const __testing = {
    currentShellSandboxIdentity,
}
