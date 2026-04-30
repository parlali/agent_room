import { spawn } from 'node:child_process'
import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import { createWriteStream } from 'node:fs'
import type { WriteStream } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import { auditRepository, roomRepository } from '../db/repositories'
import type { RoomRecord, RoomRuntimeMetadataRecord } from '../domain/types'
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

const startupHealthPollIntervalMs = 500
const startupHealthTimeoutMs = 30_000

function composeRoomCommand() {
    const runtimeEngineProfile = getRuntimeEngineProfile()
    return runtimeEngineProfile.resolveCommand()
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
    startedAt: Date | null
    configVersion: number
    tokenVersion: number
}) {
    await writeRuntimeFileMetadata(input.path, {
        roomId: input.roomId,
        port: input.port,
        pid: input.pid,
        startedAt: input.startedAt?.toISOString() ?? null,
        configVersion: input.configVersion,
        tokenVersion: input.tokenVersion,
    })
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
        await roomRepository.updateRoomStatus(room.id, 'starting')
        await writeRoomRuntimeMetadataFile({
            path: paths.runtimeMetadataPath,
            roomId: room.id,
            port,
            pid,
            startedAt,
            configVersion: materialized.configVersion,
            tokenVersion: materialized.tokenVersion,
        })
        await persistRuntimeMetadata({
            roomId: room.id,
            port,
            pid,
            configVersion: materialized.configVersion,
            tokenVersion: materialized.tokenVersion,
            healthStatus: 'unknown',
            startedAt,
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

        await roomRepository.updateRoomStatus(room.id, 'running')
        await writeRoomRuntimeMetadataFile({
            path: paths.runtimeMetadataPath,
            roomId: room.id,
            port,
            pid,
            startedAt,
            configVersion: materialized.configVersion,
            tokenVersion: materialized.tokenVersion,
        })
        await persistRuntimeMetadata({
            roomId: room.id,
            port,
            pid,
            configVersion: materialized.configVersion,
            tokenVersion: materialized.tokenVersion,
            healthStatus: 'healthy',
            startedAt,
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

        child.on('exit', async (code, signal) => {
            const current = getRuntimeProcess(room.id)
            if (current) {
                clearInterval(current.healthTimer)
                current.logStream.end()
                loopbackPortAllocator.release(current.port)
                deleteRuntimeProcess(room.id)
            }

            const stoppedCleanly = consumeRoomStopping(room.id) || code === 0
            const status = stoppedCleanly ? 'stopped' : 'failed'
            await roomRepository.updateRoomStatus(room.id, status)
            await writeRoomRuntimeMetadataFile({
                path: paths.runtimeMetadataPath,
                roomId: room.id,
                port,
                pid: null,
                startedAt: null,
                configVersion: materialized.configVersion,
                tokenVersion: materialized.tokenVersion,
            })
            await persistRuntimeMetadata({
                roomId: room.id,
                port,
                pid: null,
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
            startedAt: null,
            configVersion: currentMetadata.configVersion,
            tokenVersion: currentMetadata.tokenVersion,
        })
        await persistRuntimeMetadata({
            roomId: room.id,
            port,
            pid: null,
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

export async function stopRoomProcess(roomId: string, actorUserId: string | null): Promise<void> {
    const running = getRuntimeProcess(roomId)
    if (!running) {
        const metadata = await getRuntimeMetadataOrCreate(roomId)
        const paths = await ensureRoomFilesystemLayout(roomId)
        await roomRepository.updateRoomStatus(roomId, 'stopped')
        if (metadata.port !== null) {
            await writeRoomRuntimeMetadataFile({
                path: paths.runtimeMetadataPath,
                roomId,
                port: metadata.port,
                pid: null,
                startedAt: null,
                configVersion: metadata.configVersion,
                tokenVersion: metadata.tokenVersion,
            })
        }
        await persistRuntimeMetadata({
            roomId,
            port: metadata.port,
            pid: null,
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
                wasRunning: false,
            },
        })
        return
    }

    markRoomStopping(roomId)
    clearInterval(running.healthTimer)
    running.child.kill('SIGTERM')
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
