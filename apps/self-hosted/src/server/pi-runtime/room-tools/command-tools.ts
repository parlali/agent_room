import {
    defineTool,
    type AgentToolResult,
    type ToolDefinition,
} from '@mariozechner/pi-coding-agent'
import { Type } from '@mariozechner/pi-ai'
import { currentShellSandboxIdentity } from '../shell-sandbox'
import { currentToolRunContext } from '../tool-run-context'
import {
    backgroundCommandMaxOutputBytes,
    type BackgroundCommandRecord,
    getBackgroundCommand,
    listBackgroundCommands,
    startBackgroundCommand,
    terminateBackgroundCommand,
} from '../background-commands'
import {
    audit,
    clampPositiveInteger,
    textResult,
    type RoomToolContext,
    type RoomToolDetails,
} from './shared'
import { boundToolOutput } from '../tool-output-bounds'

function commandDurationMs(record: BackgroundCommandRecord): number {
    const end = record.finishedAt ? Date.parse(record.finishedAt) : Date.now()
    return Math.max(0, end - Date.parse(record.startedAt))
}

function commandHeader(record: BackgroundCommandRecord): string {
    return [
        `commandId: ${record.commandId}`,
        `status: ${record.status}`,
        `exitCode: ${record.exitCode ?? 'null'}`,
        `signal: ${record.signal ?? 'null'}`,
        `startedAt: ${record.startedAt}`,
        `finishedAt: ${record.finishedAt ?? 'null'}`,
        `outputTruncated: ${record.outputTruncated}`,
    ].join('\n')
}

function commandStatusResult(
    ctx: RoomToolContext,
    record: BackgroundCommandRecord,
): AgentToolResult<RoomToolDetails> {
    const header = commandHeader(record)
    return textResult(header, commandDetails(ctx, record))
}

function commandDetails(ctx: RoomToolContext, record: BackgroundCommandRecord): RoomToolDetails {
    return {
        path: record.cwd,
        sandboxMode: currentShellSandboxIdentity(ctx.config).mode,
        byteLength: record.outputByteLength,
        truncated: record.outputTruncated,
        exitCode: record.exitCode,
        timedOut: record.signal === 'timeout',
        aborted:
            record.signal === 'abort' ||
            record.signal === 'manual' ||
            record.signal === 'runtime_shutdown',
        durationMs: commandDurationMs(record),
        commandId: record.commandId,
        status: record.status,
    }
}

async function commandResult(
    ctx: RoomToolContext,
    record: BackgroundCommandRecord,
): Promise<AgentToolResult<RoomToolDetails>> {
    const header = commandHeader(record)
    const outputBudget = Math.max(
        0,
        backgroundCommandMaxOutputBytes - Buffer.byteLength(header) - 2,
    )
    const outputBytes = Buffer.from(record.output)
    const outputText =
        outputBytes.byteLength > outputBudget
            ? outputBytes.subarray(outputBytes.byteLength - outputBudget).toString('utf8')
            : record.output
    const text = outputText.trim() ? `${header}\n\n${outputText}` : header
    const redact = ctx.redactCommandOutput ?? ctx.redactString
    const safeText = redact ? redact(text) : text
    const bounded = await boundToolOutput({
        config: ctx.config,
        text: safeText,
        label: `command-${record.commandId}`,
        extension: 'log',
        previewMode: 'tail',
    })
    return textResult(bounded.text, {
        ...commandDetails(ctx, record),
        modelVisibleTruncated: bounded.modelVisibleTruncated,
        ...(bounded.outputArtifact
            ? {
                  outputArtifact: bounded.outputArtifact,
              }
            : {}),
    })
}

export function createShellTool(ctx: RoomToolContext): ToolDefinition {
    return defineTool({
        name: 'shell',
        label: 'Shell',
        description:
            'Start a bounded background shell command from the workspace and wait briefly for output.',
        promptSnippet:
            'shell starts a workspace command, waits briefly, and returns a command id for polling.',
        parameters: Type.Object({
            command: Type.String(),
            timeoutMs: Type.Optional(Type.Number()),
            waitMs: Type.Optional(Type.Number()),
        }),
        executionMode: 'sequential',
        execute: async (_toolCallId, input, signal, onUpdate) => {
            const runContext = currentToolRunContext()
            const timeoutMs = clampPositiveInteger(
                input.timeoutMs,
                ctx.config.budgets.shellCommandMs,
                ctx.config.budgets.shellCommandMs,
            )
            const waitMs = clampPositiveInteger(
                input.waitMs,
                ctx.config.budgets.shortCommandWaitMs,
                ctx.config.budgets.shortCommandWaitMs,
            )
            let latest: BackgroundCommandRecord | null = null
            latest = await startBackgroundCommand({
                config: ctx.config,
                command: input.command,
                timeoutMs,
                sessionKey: runContext?.sessionKey,
                runId: runContext?.runId,
                signal,
                redactOutput: ctx.redactCommandOutput,
                onOutput: (record) => {
                    latest = record
                    onUpdate?.(commandStatusResult(ctx, record))
                },
            })
            const deadline = Date.now() + waitMs
            while (latest.status === 'running' && Date.now() < deadline) {
                await new Promise((resolveDelay) => setTimeout(resolveDelay, 100))
                latest =
                    (await getBackgroundCommand({
                        config: ctx.config,
                        commandId: latest.commandId,
                    })) ?? latest
            }
            await audit(ctx, 'shell', {
                path: ctx.config.paths.workspaceDir,
                sandboxMode: currentShellSandboxIdentity(ctx.config).mode,
                commandId: latest.commandId,
                status: latest.status,
                exitCode: latest.exitCode,
                timedOut: latest.signal === 'timeout',
                aborted: latest.signal === 'abort' || latest.signal === 'manual',
                durationMs: commandDurationMs(latest),
                truncated: latest.outputTruncated,
            })
            return commandResult(ctx, latest)
        },
    })
}

export function createCommandStartTool(ctx: RoomToolContext): ToolDefinition {
    return defineTool({
        name: 'command_start',
        label: 'Start Command',
        description: 'Start a bounded workspace background command and return its command id.',
        promptSnippet: 'command_start starts long workspace commands for later polling.',
        parameters: Type.Object({
            command: Type.String(),
            timeoutMs: Type.Optional(Type.Number()),
        }),
        executionMode: 'sequential',
        execute: async (_toolCallId, input, signal) => {
            const runContext = currentToolRunContext()
            const record = await startBackgroundCommand({
                config: ctx.config,
                command: input.command,
                timeoutMs: clampPositiveInteger(
                    input.timeoutMs,
                    ctx.config.budgets.shellCommandMs,
                    ctx.config.budgets.shellCommandMs,
                ),
                sessionKey: runContext?.sessionKey,
                runId: runContext?.runId,
                signal,
                redactOutput: ctx.redactCommandOutput,
            })
            await audit(ctx, 'command_start', {
                path: record.cwd,
                commandId: record.commandId,
                status: record.status,
                sandboxMode: currentShellSandboxIdentity(ctx.config).mode,
            })
            return commandStatusResult(ctx, record)
        },
    })
}

export function createCommandPollTool(ctx: RoomToolContext): ToolDefinition {
    return defineTool({
        name: 'command_poll',
        label: 'Poll Command',
        description: 'Poll output and status for a workspace background command.',
        promptSnippet: 'command_poll reads bounded output and status from a background command id.',
        parameters: Type.Object({
            commandId: Type.String(),
        }),
        execute: async (_toolCallId, input) => {
            const record = await getBackgroundCommand({
                config: ctx.config,
                commandId: input.commandId,
            })
            if (!record) {
                throw new Error(`Command ${input.commandId} was not found`)
            }
            await audit(ctx, 'command_poll', {
                path: record.cwd,
                commandId: record.commandId,
                status: record.status,
                byteLength: record.outputByteLength,
                truncated: record.outputTruncated,
            })
            return commandResult(ctx, record)
        },
    })
}

export function createCommandStatusTool(ctx: RoomToolContext): ToolDefinition {
    return defineTool({
        name: 'command_status',
        label: 'Command Status',
        description: 'List recent workspace background commands or read one status by id.',
        promptSnippet: 'command_status lists recent background commands without unbounded output.',
        parameters: Type.Object({
            commandId: Type.Optional(Type.String()),
        }),
        execute: async (_toolCallId, input) => {
            if (input.commandId) {
                const record = await getBackgroundCommand({
                    config: ctx.config,
                    commandId: input.commandId,
                })
                if (!record) {
                    throw new Error(`Command ${input.commandId} was not found`)
                }
                await audit(ctx, 'command_status', {
                    path: record.cwd,
                    commandId: record.commandId,
                    status: record.status,
                })
                return commandStatusResult(ctx, record)
            }

            const records = await listBackgroundCommands(ctx.config)
            const rows = records
                .slice(0, 50)
                .map((record) =>
                    [
                        record.commandId,
                        record.status,
                        record.exitCode ?? 'null',
                        record.startedAt,
                        record.finishedAt ?? 'null',
                        record.outputTruncated ? 'truncated' : 'complete',
                        record.command,
                    ].join(' '),
                )
            const text = rows.join('\n')
            await audit(ctx, 'command_status', {
                path: ctx.config.paths.workspaceDir,
                byteLength: Buffer.byteLength(text),
                truncated: records.length > 50,
            })
            return textResult(text, {
                path: ctx.config.paths.workspaceDir,
                byteLength: Buffer.byteLength(text),
                truncated: records.length > 50,
            })
        },
    })
}

export function createCommandTerminateTool(ctx: RoomToolContext): ToolDefinition {
    return defineTool({
        name: 'command_terminate',
        label: 'Terminate Command',
        description: 'Terminate a running workspace background command by command id.',
        promptSnippet: 'command_terminate stops a background command when it is no longer needed.',
        parameters: Type.Object({
            commandId: Type.String(),
        }),
        executionMode: 'sequential',
        execute: async (_toolCallId, input) => {
            const record = await terminateBackgroundCommand({
                config: ctx.config,
                commandId: input.commandId,
            })
            await audit(ctx, 'command_terminate', {
                path: record.cwd,
                commandId: record.commandId,
                status: record.status,
                signal: record.signal,
            })
            return commandStatusResult(ctx, record)
        },
    })
}
