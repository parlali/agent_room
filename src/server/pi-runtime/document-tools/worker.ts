import { spawn } from 'node:child_process'
import type { PiRuntimeConfig } from '../../rooms/pi-runtime-config'
import { buildBoundedProcessEnv } from '../../security/process-env'
import {
    ensureShellWritableFile,
    resolveShellSandboxIdentity,
    type ShellSandboxIdentity,
} from '../shell-sandbox'
import type { DocumentToolContext } from './types'

/**
 * Run a command inside a bounded sandboxed environment and capture its combined stdout/stderr.
 *
 * @param input.config - Runtime configuration used to build the bounded process environment (provides paths and identifiers).
 * @param input.command - Executable to run.
 * @param input.args - Arguments passed to the executable.
 * @param input.cwd - Working directory for the spawned process.
 * @param input.timeoutMs - Maximum time in milliseconds before the process is terminated.
 * @param input.signal - Optional AbortSignal that aborts the run when triggered.
 * @param input.outputLimitBytes - Optional maximum number of bytes to retain from the captured output (default: 12000).
 * @param input.outputMode - If `'head'`, retain the leading `outputLimitBytes` bytes; if `'tail'`, retain the trailing `outputLimitBytes` bytes.
 * @returns The combined stdout and stderr produced by the command, truncated according to `outputLimitBytes` and `outputMode`.
 */
export async function runDocumentWorker(input: {
    config: PiRuntimeConfig
    command: string
    args: string[]
    cwd: string
    timeoutMs: number
    signal?: AbortSignal
    outputLimitBytes?: number
    outputMode?: 'head' | 'tail'
}): Promise<string> {
    return await new Promise((resolvePromise, reject) => {
        let settled = false
        const identity = currentWorkerSandboxIdentity()
        const child = spawn(input.command, input.args, {
            cwd: input.cwd,
            detached: true,
            env: buildBoundedProcessEnv({
                HOME: input.config.paths.homeDir,
                TMPDIR: input.config.paths.tmpDir,
                AGENT_ROOM_ROOM_ID: input.config.runtime.roomId,
                AGENT_ROOM_WORKSPACE_DIR: input.config.paths.workspaceDir,
                AGENT_ROOM_STORE_DIR: input.config.paths.storeDir,
            }),
            stdio: ['ignore', 'pipe', 'pipe'],
            ...(identity.uid === undefined ? {} : { uid: identity.uid }),
            ...(identity.gid === undefined ? {} : { gid: identity.gid }),
        })
        let output = ''
        let timer: ReturnType<typeof setTimeout> | null = null
        let abort: () => void = () => {}
        const finish = (error: Error | null, value = '') => {
            if (settled) {
                return
            }
            settled = true
            if (timer) {
                clearTimeout(timer)
            }
            input.signal?.removeEventListener('abort', abort)
            if (error) {
                reject(error)
            } else {
                resolvePromise(value)
            }
        }
        const terminate = (signal: NodeJS.Signals) => {
            if (child.pid) {
                try {
                    process.kill(-child.pid, signal)
                    return
                } catch {}
            }
            child.kill(signal)
        }
        const terminateWithEscalation = () => {
            terminate('SIGTERM')
            setTimeout(() => {
                if (child.exitCode === null && child.signalCode === null) {
                    terminate('SIGKILL')
                }
            }, 2000).unref()
        }
        abort = () => {
            terminateWithEscalation()
            finish(new Error(`${input.command} aborted`))
        }
        const append = (chunk: Buffer) => {
            const limit = input.outputLimitBytes ?? 12000
            const next = `${output}${chunk.toString('utf8')}`
            output = input.outputMode === 'head' ? next.slice(0, limit) : next.slice(-limit)
        }
        timer = setTimeout(() => {
            terminateWithEscalation()
            finish(new Error(`${input.command} timed out`))
        }, input.timeoutMs)
        timer.unref()
        input.signal?.addEventListener('abort', abort, { once: true })
        child.stdout.on('data', append)
        child.stderr.on('data', append)
        child.on('error', (error) => finish(error))
        child.on('close', (exitCode) => {
            if (exitCode === 0) {
                finish(null, output)
            } else {
                finish(new Error(`${input.command} failed with exit code ${exitCode}: ${output}`))
            }
        })
    })
}

/**
 * Determine the sandbox identity used for worker shell processes.
 *
 * @returns The ShellSandboxIdentity containing the uid (if available), sandbox allowance flags, and environment context to apply when spawning worker processes.
 */
function currentWorkerSandboxIdentity(): ShellSandboxIdentity {
    return resolveShellSandboxIdentity({
        nodeEnv: process.env.NODE_ENV,
        unsafeAllowUnsandboxed: process.env.AGENT_ROOM_UNSAFE_ALLOW_UNSANDBOXED_SHELL,
        uid: typeof process.getuid === 'function' ? process.getuid() : null,
    })
}

/**
 * Create a PNG preview of the first page of a PDF and ensure the output file is writable.
 *
 * @param ctx - Document tool context providing configuration and workspace paths.
 * @param inputPath - Filesystem path to the source PDF.
 * @param outputPath - Filesystem path for the resulting PNG (will be created or overwritten).
 * @param signal - Optional AbortSignal to cancel the operation.
 */
export async function renderPdfPreview(
    ctx: DocumentToolContext,
    inputPath: string,
    outputPath: string,
    signal?: AbortSignal,
): Promise<void> {
    await runDocumentWorker({
        config: ctx.config,
        command: 'pdftoppm',
        args: ['-png', '-f', '1', '-singlefile', inputPath, outputPath.replace(/\.png$/i, '')],
        cwd: ctx.config.paths.workspaceDir,
        timeoutMs: ctx.config.budgets.documentWorkerMs,
        signal,
    })
    await ensureShellWritableFile(outputPath)
}
