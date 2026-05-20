import { spawn } from 'node:child_process'
import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import { createWriteStream } from 'node:fs'
import type { WriteStream } from 'node:fs'
import { mkdir, readFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { auditRepository, roomRepository } from '../db/repositories'
import type { RoomRecord, RoomRuntimeMetadataRecord, RuntimeSandboxIdentity } from '../domain/types'
import { buildBoundedProcessEnv } from '../security/process-env'
import { loopbackPortAllocator } from './port-allocator'
import {
    consumeRoomStopping,
    deleteRuntimeProcess,
    getRuntimeProcess,
    hasRuntimeProcess,
    markRoomStopping,
    setRuntimeProcess,
    withRuntimeStartLock,
} from './runtime-process-store'
import { collectRuntimeHealthSnapshot, writeRuntimeHealthSnapshot } from './runtime-health'
import {
    allocateRoomPort,
    getRuntimeMetadataOrCreate,
    materializeRoomRuntime,
    persistRuntimeMetadata,
} from './runtime-persistence'
import { writeRuntimeFileMetadata } from './runtime-materializer'
import { ensureRoomFilesystemLayout } from './room-paths'
import { getRuntimeEngineProfile } from './runtime-engine-profile'
import { ensureRoomOnboardingStarted } from './room-onboarding'

const startupHealthPollIntervalMs = 500
const startupHealthTimeoutMs = 30_000
const stopProcessTimeoutMs = 5_000
const stopProcessKillGraceMs = 2_000

function composeRoomCommand() {
    const runtimeEngineProfile = getRuntimeEngineProfile()
    return runtimeEngineProfile.resolveCommand()
}

async function processCommandLine(pid: number): Promise<string> {
    try {
        return (await readFile(`/proc/${pid}/cmdline`, 'utf8')).replaceAll('\u0000', ' ')
    } catch {
        return ''
    }
}

async function killMaterializedRuntimeProcess(input: {
    pid: number | null
    runtimeConfigPath: string
}): Promise<boolean> {
    if (!input.pid || input.pid <= 1 || input.pid === process.pid) {
        return false
    }
    const commandLine = await processCommandLine(input.pid)
    if (!commandLine.includes(input.runtimeConfigPath)) {
        return false
    }
    try {
        process.kill(input.pid, 'SIGTERM')
    } catch {
        return false
    }
    const deadline = Date.now() + stopProcessTimeoutMs
    while (Date.now() < deadline) {
        const current = await processCommandLine(input.pid)
        if (!current) {
            return true
        }
        await new Promise((resolve) => setTimeout(resolve, 100))
    }
    try {
        process.kill(input.pid, 'SIGKILL')
    } catch {}
    return true
}

async function streamLogs(
    child: ChildProcessWithoutNullStreams,
    logFilePath: string,
): Promise<WriteStream> {
    await mkdir(dirname(logFilePath), { recursive: true })
    const stream = createWriteStream(logFilePath, { flags: 'a' })
    child.stdout.pipe(stream)
    child.stderr.pipe(stream)
    return stream
}

async function startHealthLoop(input: {
    roomId: string
    port: number
    pid: number
    healthFilePath: string
    configVersion: number
    tokenVersion: number
    startedAt: Date
}): Promise<ReturnType<typeof setInterval>> {
    const updateHealth = async () => {
        const snapshot = await collectRuntimeHealthSnapshot({
            roomId: input.roomId,
            port: input.port,
            pid: input.pid,
        })
        await writeRuntimeHealthSnapshot(input.healthFilePath, snapshot)
        await roomRepository.updateRoomStatus(
            input.roomId,
            snapshot.healthy ? 'running' : 'degraded',
        )
        await persistRuntimeMetadata({
            roomId: input.roomId,
            port: input.port,
            pid: input.pid,
            configVersion: input.configVersion,
            tokenVersion: input.tokenVersion,
            healthStatus: snapshot.healthy ? 'healthy' : 'unhealthy',
            startedAt: input.startedAt,
            lastError: snapshot.healthy ? null : snapshot.message,
        })
    }

    return setInterval(() => {
        void updateHealth().catch((error) => {
            console.error(
                `Failed to refresh runtime health for room ${input.roomId}`,
                error instanceof Error ? error.message : error,
            )
        })
    }, 5000)
}

async function sleep(ms: number): Promise<void> {
    await new Promise((resolve) => {
        setTimeout(resolve, ms)
    })
}

async function waitForProcessExit(child: ChildProcessWithoutNullStreams): Promise<void> {
    if (child.exitCode !== null || child.signalCode !== null) {
        return
    }

    await new Promise<void>((resolve) => {
        let settled = false
        const finish = () => {
            if (settled) {
                return
            }
            settled = true
            clearTimeout(killTimer)
            clearTimeout(resolveTimer)
            child.off('exit', finish)
            resolve()
        }
        const killTimer = setTimeout(() => {
            if (!settled) {
                child.kill('SIGKILL')
            }
        }, stopProcessTimeoutMs)
        const resolveTimer = setTimeout(finish, stopProcessTimeoutMs + stopProcessKillGraceMs)
        killTimer.unref()
        resolveTimer.unref()
        child.once('exit', finish)
    })
}

async function waitForHealthyStartup(input: {
    roomId: string
    port: number
    pid: number
    healthFilePath: string
}): Promise<void> {
    const deadline = Date.now() + startupHealthTimeoutMs
    let lastMessage = 'Room runtime did not report health'

    while (Date.now() <= deadline) {
        const snapshot = await collectRuntimeHealthSnapshot({
            roomId: input.roomId,
            port: input.port,
            pid: input.pid,
        })
        lastMessage = snapshot.message
        await writeRuntimeHealthSnapshot(input.healthFilePath, snapshot)
        if (snapshot.healthy) {
            return
        }
        await sleep(startupHealthPollIntervalMs)
    }

    throw new Error(`Initial runtime health check failed: ${lastMessage}`)
}

function buildMaterializationMetadata(
    currentMetadata: RoomRuntimeMetadataRecord,
    port: number,
): RoomRuntimeMetadataRecord {
    const startedAt = new Date()
    return {
        ...currentMetadata,
        port,
        configVersion: currentMetadata.configVersion + 1,
        startedAt,
    }
}

async function writeRoomRuntimeMetadataFile(input: {
    path: string
    roomId: string
    port: number
    pid: number | null
    sandbox: RuntimeSandboxIdentity | null
    startedAt: Date | null
    configVersion: number
    tokenVersion: number
}) {
    await writeRuntimeFileMetadata(input.path, {
        roomId: input.roomId,
        port: input.port,
        pid: input.pid,
        sandbox: input.sandbox,
        startedAt: input.startedAt?.toISOString() ?? null,
        configVersion: input.configVersion,
        tokenVersion: input.tokenVersion,
    })
}

function sandboxFromMetadata(
    metadata: RoomRuntimeMetadataRecord,
): Extract<RuntimeSandboxIdentity, { mode: 'per-room' }> | null {
    if (
        metadata.sandboxUid === null ||
        metadata.sandboxGid === null ||
        metadata.sandboxUserName === null ||
        metadata.sandboxGroupName === null
    ) {
        return null
    }
    return {
        mode: 'per-room',
        uid: metadata.sandboxUid,
        gid: metadata.sandboxGid,
        userName: metadata.sandboxUserName,
        groupName: metadata.sandboxGroupName,
    }
}

async function persistRoomRuntimeState(input: {
    roomId: string
    status: RoomRecord['status']
    metadataPath: string
    port: number
    pid: number | null
    sandbox: RuntimeSandboxIdentity | null
    startedAt: Date | null
    configVersion: number
    tokenVersion: number
    healthStatus: RoomRuntimeMetadataRecord['healthStatus']
    lastError: string | null
}): Promise<void> {
    await roomRepository.updateRoomStatus(input.roomId, input.status)
    await writeRoomRuntimeMetadataFile({
        path: input.metadataPath,
        roomId: input.roomId,
        port: input.port,
        pid: input.pid,
        sandbox: input.sandbox,
        startedAt: input.startedAt,
        configVersion: input.configVersion,
        tokenVersion: input.tokenVersion,
    })
    await persistRuntimeMetadata({
        roomId: input.roomId,
        port: input.port,
        pid: input.pid,
        sandboxUid: input.sandbox?.mode === 'per-room' ? input.sandbox.uid : null,
        sandboxGid: input.sandbox?.mode === 'per-room' ? input.sandbox.gid : null,
        sandboxUserName: input.sandbox?.mode === 'per-room' ? input.sandbox.userName : null,
        sandboxGroupName: input.sandbox?.mode === 'per-room' ? input.sandbox.groupName : null,
        configVersion: input.configVersion,
        tokenVersion: input.tokenVersion,
        healthStatus: input.healthStatus,
        startedAt: input.startedAt,
        lastError: input.lastError,
    })
}

async function restartRoomIfDesiredAfterStop(input: {
    roomId: string
    restart: (room: RoomRecord) => Promise<void>
}): Promise<boolean> {
    const latestRoom = await roomRepository.findRoomById(input.roomId)
    if (latestRoom?.desiredState !== 'running') {
        return false
    }

    await auditRepository.appendEvent({
        actorUserId: null,
        roomId: input.roomId,
        action: 'room.runtime_restart_after_stop',
        payload: {},
    })
    await input.restart(latestRoom)
    return true
}

async function startRoomProcessUnlocked(room: RoomRecord): Promise<void> {
    if (hasRuntimeProcess(room.id)) {
        return
    }

    const command = composeRoomCommand()
    const port = await allocateRoomPort(room.id)
    const paths = await ensureRoomFilesystemLayout(room.id)
    let didRegisterProcess = false
    let childProcess: ChildProcessWithoutNullStreams | null = null
    let startupLogStream: WriteStream | null = null

    try {
        const currentMetadata = await getRuntimeMetadataOrCreate(room.id)
        const metadataForMaterialization = buildMaterializationMetadata(currentMetadata, port)
        const startedAt = metadataForMaterialization.startedAt ?? new Date()
        const materialized = await materializeRoomRuntime(room, metadataForMaterialization)

        const child = spawn(command.command, command.args, {
            cwd: paths.workspaceDir,
            env: buildBoundedProcessEnv(materialized.env),
            stdio: 'pipe',
        })
        childProcess = child

        const pid = child.pid ?? null
        if (pid === null) {
            throw new Error(`Failed to start runtime engine process for room ${room.id}`)
        }

        startupLogStream = await streamLogs(child, paths.runtimeLogPath)
        await persistRoomRuntimeState({
            roomId: room.id,
            status: 'starting',
            metadataPath: paths.runtimeMetadataPath,
            port,
            pid,
            sandbox: materialized.sandbox,
            startedAt,
            configVersion: materialized.configVersion,
            tokenVersion: materialized.tokenVersion,
            healthStatus: 'unknown',
            lastError: null,
        })

        let clearStartupFailureListeners = () => {}
        const startupFailurePromise = new Promise<never>((_, reject) => {
            const onError = (error: Error) => {
                reject(
                    new Error(
                        `Runtime engine process failed before becoming healthy: ${error.message}`,
                    ),
                )
            }
            const onExit = (code: number | null, signal: NodeJS.Signals | null) => {
                reject(
                    new Error(
                        `Runtime engine process exited before becoming healthy (code=${code ?? 'null'} signal=${signal ?? 'null'})`,
                    ),
                )
            }

            child.once('error', onError)
            child.once('exit', onExit)
            clearStartupFailureListeners = () => {
                child.off('error', onError)
                child.off('exit', onExit)
            }
        })

        await Promise.race([
            waitForHealthyStartup({
                roomId: room.id,
                port,
                pid,
                healthFilePath: paths.runtimeHealthPath,
            }),
            startupFailurePromise,
        ])
        clearStartupFailureListeners()

        await persistRoomRuntimeState({
            roomId: room.id,
            status: 'running',
            metadataPath: paths.runtimeMetadataPath,
            port,
            pid,
            sandbox: materialized.sandbox,
            startedAt,
            configVersion: materialized.configVersion,
            tokenVersion: materialized.tokenVersion,
            healthStatus: 'healthy',
            lastError: null,
        })

        const healthTimer = await startHealthLoop({
            roomId: room.id,
            port,
            pid,
            healthFilePath: paths.runtimeHealthPath,
            configVersion: materialized.configVersion,
            tokenVersion: materialized.tokenVersion,
            startedAt,
        })

        setRuntimeProcess(room.id, {
            child,
            healthTimer,
            port,
            logStream: startupLogStream,
        })
        didRegisterProcess = true
        startupLogStream = null

        void ensureRoomOnboardingStarted(room.id).catch((error) => {
            console.error(
                `Failed to start onboarding for room ${room.id}`,
                error instanceof Error ? error.message : error,
            )
        })

        child.on('exit', async (code, signal) => {
            const current = getRuntimeProcess(room.id)
            if (current) {
                clearInterval(current.healthTimer)
                current.logStream.end()
                loopbackPortAllocator.release(current.port)
                deleteRuntimeProcess(room.id)
            }

            const stopRequest = consumeRoomStopping(room.id)
            const stoppedCleanly = stopRequest.requested || code === 0
            const status = stoppedCleanly ? 'stopped' : 'failed'
            await roomRepository.updateRoomStatus(room.id, status)
            await writeRoomRuntimeMetadataFile({
                path: paths.runtimeMetadataPath,
                roomId: room.id,
                port,
                pid: null,
                sandbox: materialized.sandbox,
                startedAt: null,
                configVersion: materialized.configVersion,
                tokenVersion: materialized.tokenVersion,
            })
            await persistRuntimeMetadata({
                roomId: room.id,
                port,
                pid: null,
                sandboxUid:
                    materialized.sandbox.mode === 'per-room' ? materialized.sandbox.uid : null,
                sandboxGid:
                    materialized.sandbox.mode === 'per-room' ? materialized.sandbox.gid : null,
                sandboxUserName:
                    materialized.sandbox.mode === 'per-room' ? materialized.sandbox.userName : null,
                sandboxGroupName:
                    materialized.sandbox.mode === 'per-room'
                        ? materialized.sandbox.groupName
                        : null,
                configVersion: materialized.configVersion,
                tokenVersion: materialized.tokenVersion,
                healthStatus: status === 'failed' ? 'unhealthy' : 'unknown',
                startedAt: null,
                lastError:
                    status === 'failed'
                        ? `exit_code=${code ?? 'null'} signal=${signal ?? 'null'}`
                        : null,
            })
            await auditRepository.appendEvent({
                actorUserId: null,
                roomId: room.id,
                action: 'room.runtime_exit',
                payload: {
                    code,
                    signal,
                    status,
                },
            })
            if (status === 'stopped' && stopRequest.restartIfDesired) {
                await restartRoomIfDesiredAfterStop({
                    roomId: room.id,
                    restart: startRoomProcess,
                })
            }
        })
    } catch (error) {
        if (startupLogStream) {
            startupLogStream.end()
        }
        if (!didRegisterProcess) {
            if (childProcess) {
                childProcess.kill('SIGTERM')
            }
            loopbackPortAllocator.release(port)
        }

        const currentMetadata = await getRuntimeMetadataOrCreate(room.id)
        await roomRepository.updateRoomStatus(room.id, 'failed')
        await writeRoomRuntimeMetadataFile({
            path: paths.runtimeMetadataPath,
            roomId: room.id,
            port,
            pid: null,
            sandbox: null,
            startedAt: null,
            configVersion: currentMetadata.configVersion,
            tokenVersion: currentMetadata.tokenVersion,
        })
        await persistRuntimeMetadata({
            roomId: room.id,
            port,
            pid: null,
            sandboxUid: currentMetadata.sandboxUid,
            sandboxGid: currentMetadata.sandboxGid,
            sandboxUserName: currentMetadata.sandboxUserName,
            sandboxGroupName: currentMetadata.sandboxGroupName,
            configVersion: currentMetadata.configVersion,
            tokenVersion: currentMetadata.tokenVersion,
            healthStatus: 'unhealthy',
            startedAt: null,
            lastError: error instanceof Error ? error.message : 'unknown startup error',
        })
        await auditRepository.appendEvent({
            actorUserId: null,
            roomId: room.id,
            action: 'room.runtime_start_failed',
            payload: {
                command: command.command,
                args: command.args,
                port,
                logPath: paths.runtimeLogPath,
                error: error instanceof Error ? error.message : 'unknown startup error',
            },
        })
        throw error
    }
}

export async function startRoomProcess(room: RoomRecord): Promise<void> {
    await withRuntimeStartLock(room.id, async () => {
        await startRoomProcessUnlocked(room)
    })
}

export async function stopRoomProcess(
    roomId: string,
    actorUserId: string | null,
    options: {
        restartIfDesired?: boolean
    } = {},
): Promise<void> {
    const running = getRuntimeProcess(roomId)
    if (!running) {
        const metadata = await getRuntimeMetadataOrCreate(roomId)
        const paths = await ensureRoomFilesystemLayout(roomId)
        const sandbox = sandboxFromMetadata(metadata)
        const killed = await killMaterializedRuntimeProcess({
            pid: metadata.pid,
            runtimeConfigPath: paths.runtimeConfigPath,
        })
        await roomRepository.updateRoomStatus(roomId, 'stopped')
        if (metadata.port !== null) {
            await writeRoomRuntimeMetadataFile({
                path: paths.runtimeMetadataPath,
                roomId,
                port: metadata.port,
                pid: null,
                sandbox,
                startedAt: null,
                configVersion: metadata.configVersion,
                tokenVersion: metadata.tokenVersion,
            })
        }
        await persistRuntimeMetadata({
            roomId,
            port: metadata.port,
            pid: null,
            sandboxUid: sandbox?.uid ?? null,
            sandboxGid: sandbox?.gid ?? null,
            sandboxUserName: sandbox?.userName ?? null,
            sandboxGroupName: sandbox?.groupName ?? null,
            configVersion: metadata.configVersion,
            tokenVersion: metadata.tokenVersion,
            healthStatus: 'unknown',
            startedAt: null,
            lastError: null,
        })
        await auditRepository.appendEvent({
            actorUserId,
            roomId,
            action: 'room.runtime_stopped',
            payload: {
                wasRunning: killed,
                recoveredFromMetadata: killed,
            },
        })
        return
    }

    markRoomStopping(roomId, {
        restartIfDesired: options.restartIfDesired,
    })
    clearInterval(running.healthTimer)
    running.child.kill('SIGTERM')
    await waitForProcessExit(running.child)
    await auditRepository.appendEvent({
        actorUserId,
        roomId,
        action: 'room.runtime_stopped',
        payload: {
            wasRunning: true,
        },
    })
}

export async function roomProcessSnapshot(roomId: string) {
    const running = getRuntimeProcess(roomId)
    if (!running) {
        return {
            running: false,
        }
    }
    return {
        running: true,
        pid: running.child.pid ?? null,
        port: running.port,
    }
}

export const __testing = {
    restartRoomIfDesiredAfterStop,
}
