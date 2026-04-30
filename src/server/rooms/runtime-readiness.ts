import { spawnSync } from 'node:child_process'
import { getRuntimeEngineProfile } from './runtime-engine-profile'

export interface RoomSetupIssue {
    code: string
    severity: 'blocking' | 'warning'
    message: string
}

export interface RoomSetupReadinessSnapshot {
    command: string
    generatedAt: string
    hasBlockingIssues: boolean
    issues: RoomSetupIssue[]
}

interface CommandProbeResult {
    available: boolean
    reason: string
}

const readinessCacheTtlMs = 5000
let cachedReadinessSnapshot: RoomSetupReadinessSnapshot | null = null
let cachedReadinessAt = 0

function probeCommand(command: string, args: string[] = ['--version']): CommandProbeResult {
    try {
        const result = spawnSync(command, args, {
            encoding: 'utf8',
            timeout: 4000,
        })

        if (result.error) {
            const code =
                typeof result.error === 'object' && result.error !== null && 'code' in result.error
                    ? String((result.error as { code: unknown }).code)
                    : 'unknown'
            return {
                available: false,
                reason: `command probe failed (${code})`,
            }
        }

        return {
            available: true,
            reason: 'command is executable',
        }
    } catch (error) {
        return {
            available: false,
            reason: error instanceof Error ? error.message : 'command probe failed',
        }
    }
}

export function getRoomSetupReadiness(input?: {
    forceRefresh?: boolean
}): RoomSetupReadinessSnapshot {
    if (!input?.forceRefresh && cachedReadinessSnapshot) {
        if (Date.now() - cachedReadinessAt < readinessCacheTtlMs) {
            return cachedReadinessSnapshot
        }
    }

    const runtimeEngineProfile = getRuntimeEngineProfile()
    let runtimeCommand = 'unresolved'
    let commandProbe: CommandProbeResult = {
        available: false,
        reason: 'runtime command could not be resolved',
    }

    try {
        runtimeCommand = runtimeEngineProfile.resolveCommand().command
        commandProbe = probeCommand(runtimeCommand)
    } catch (error) {
        commandProbe = {
            available: false,
            reason:
                error instanceof Error ? error.message : 'runtime command could not be resolved',
        }
    }

    const issues: RoomSetupIssue[] = []

    if (!commandProbe.available) {
        issues.push({
            code: 'runtime_command_unavailable',
            severity: 'blocking',
            message: `Bundled Pi runtime command is unavailable: ${commandProbe.reason}`,
        })
    }

    const snapshot: RoomSetupReadinessSnapshot = {
        command: runtimeCommand,
        generatedAt: new Date().toISOString(),
        hasBlockingIssues: issues.some((issue) => issue.severity === 'blocking'),
        issues,
    }

    cachedReadinessSnapshot = snapshot
    cachedReadinessAt = Date.now()

    return snapshot
}

export function assertRoomSetupReady(input?: { readiness?: RoomSetupReadinessSnapshot }) {
    const readiness = input?.readiness ?? getRoomSetupReadiness()
    if (!readiness.hasBlockingIssues) {
        return
    }

    throw new Error(readiness.issues[0]?.message ?? 'Room runtime prerequisites are not satisfied')
}

export const __testing = {
    resetReadinessCache() {
        cachedReadinessSnapshot = null
        cachedReadinessAt = 0
    },
}
