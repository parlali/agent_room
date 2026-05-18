import { spawn } from 'node:child_process'
import type { PiRuntimeConfig } from '../../rooms/pi-runtime-config'
import {
    buildBoundedProcessEnv,
    shellVisibleStoreDirEnvKey,
    shellVisibleWorkspaceDirEnvKey,
} from '../../security/process-env'
import { ensureShellWritableFile, shellSandboxSpawnCommand } from '../shell-sandbox'
import type { DocumentToolContext } from './types'

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
        const sandboxedCommand = shellSandboxSpawnCommand(input.config, input.command, input.args)
        const child = spawn(sandboxedCommand.command, sandboxedCommand.args, {
            cwd: input.cwd,
            detached: true,
            env: buildBoundedProcessEnv({
                HOME: input.config.paths.homeDir,
                TMPDIR: input.config.paths.tmpDir,
                [shellVisibleWorkspaceDirEnvKey]: input.config.paths.workspaceDir,
                [shellVisibleStoreDirEnvKey]: input.config.paths.storeDir,
            }),
            stdio: ['ignore', 'pipe', 'pipe'],
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
    await ensureShellWritableFile(ctx.config, outputPath)
}
