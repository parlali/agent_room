import { spawn } from 'node:child_process'
import { mkdtemp, rename } from 'node:fs/promises'
import { basename, dirname, extname, join } from 'node:path'
import type { PiRuntimeConfig } from '../../rooms/pi-runtime-config'
import { buildBoundedProcessEnv } from '../../security/process-env'
import {
    ensureShellWritableDirectory,
    ensureShellWritableFile,
    resolveShellSandboxIdentity,
    type ShellSandboxIdentity,
} from '../shell-sandbox'
import type { DocumentToolContext } from './types'
import { assertExists } from './paths'

async function runWorker(input: {
    config: PiRuntimeConfig
    command: string
    args: string[]
    cwd: string
    timeoutMs: number
    signal?: AbortSignal
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
            output = `${output}${chunk.toString('utf8')}`.slice(-12000)
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

function currentWorkerSandboxIdentity(): ShellSandboxIdentity {
    return resolveShellSandboxIdentity({
        nodeEnv: process.env.NODE_ENV,
        unsafeAllowUnsandboxed: process.env.AGENT_ROOM_UNSAFE_ALLOW_UNSANDBOXED_SHELL,
        uid: typeof process.getuid === 'function' ? process.getuid() : null,
    })
}

export async function exportOfficeToPdf(
    ctx: DocumentToolContext,
    inputPath: string,
    outputPath: string,
    signal?: AbortSignal,
): Promise<void> {
    await assertExists(inputPath)
    const tempDir = await mkdtemp(join(ctx.config.paths.tmpDir, 'office-export-'))
    await runWorker({
        config: ctx.config,
        command: 'soffice',
        args: [
            '--headless',
            '--nologo',
            '--nofirststartwizard',
            '--convert-to',
            'pdf',
            '--outdir',
            tempDir,
            inputPath,
        ],
        cwd: ctx.config.paths.workspaceDir,
        timeoutMs: ctx.config.budgets.documentWorkerMs,
        signal,
    })
    const generatedPath = join(tempDir, `${basename(inputPath, extname(inputPath))}.pdf`)
    await ensureShellWritableDirectory(dirname(outputPath))
    await rename(generatedPath, outputPath)
    await ensureShellWritableFile(outputPath)
}

export async function renderPdfPreview(
    ctx: DocumentToolContext,
    inputPath: string,
    outputPath: string,
    signal?: AbortSignal,
): Promise<void> {
    await runWorker({
        config: ctx.config,
        command: 'pdftoppm',
        args: ['-png', '-f', '1', '-singlefile', inputPath, outputPath.replace(/\.png$/i, '')],
        cwd: ctx.config.paths.workspaceDir,
        timeoutMs: ctx.config.budgets.documentWorkerMs,
        signal,
    })
    await ensureShellWritableFile(outputPath)
}
