import { constants as fsConstants } from 'node:fs'
import { access, readFile, readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import { roomRepository } from '../../db/repositories'
import type { RoomAgentExecutionTruth, RoomExecutionTruthSnapshot } from '../execution-types'
import { getRoomPaths } from '../room-paths'
import { toNullableNumber } from './helpers'

const runtimeFileMetadataSchema = z
    .object({
        roomId: z.string().min(1),
        port: z.number(),
        pid: z.number().nullable().optional(),
        sandbox: z
            .object({
                mode: z.string(),
                uid: z.number().nullable().optional(),
                gid: z.number().nullable().optional(),
                userName: z.string().nullable().optional(),
                groupName: z.string().nullable().optional(),
            })
            .nullable()
            .optional(),
        startedAt: z.string().nullable().optional(),
        configVersion: z.number().optional(),
        tokenVersion: z.number().optional(),
    })
    .passthrough()

const runtimeHealthFileSchema = z
    .object({
        roomId: z.string().min(1),
        port: z.number().nullable().optional(),
        pid: z.number().nullable().optional(),
        healthy: z.boolean(),
        message: z.string(),
        checkedAt: z.string(),
    })
    .passthrough()

const runtimeConfigFileSchema = z
    .object({
        runtime: z
            .object({
                bindHost: z.string().optional(),
                port: z.number().optional(),
            })
            .partial()
            .optional(),
        paths: z
            .object({
                workspaceDir: z.string().optional(),
                sessionsDir: z.string().optional(),
                internalStateDir: z.string().optional(),
                stateDir: z.string().optional(),
            })
            .partial()
            .optional(),
    })
    .passthrough()

async function fileExists(path: string): Promise<boolean> {
    try {
        await access(path, fsConstants.F_OK)
        return true
    } catch {
        return false
    }
}

async function readJsonFile<T>(path: string, schema: z.ZodType<T>): Promise<T | null> {
    try {
        const raw = await readFile(path, 'utf8')
        return schema.parse(JSON.parse(raw))
    } catch {
        return null
    }
}

async function collectSessionDirSnapshot(path: string): Promise<{
    count: number
    latestUpdateAt: number | null
}> {
    try {
        const entries = await readdir(path, { withFileTypes: true })
        let count = 0
        let latestUpdateAt: number | null = null

        for (const entry of entries) {
            if (!entry.isFile() && !entry.isDirectory()) {
                continue
            }

            count += 1
            try {
                const entryStat = await stat(join(path, entry.name))
                const updatedAt = entryStat.mtimeMs
                if (Number.isFinite(updatedAt)) {
                    latestUpdateAt =
                        latestUpdateAt === null || updatedAt > latestUpdateAt
                            ? updatedAt
                            : latestUpdateAt
                }
            } catch {
                continue
            }
        }

        return {
            count,
            latestUpdateAt,
        }
    } catch {
        return {
            count: 0,
            latestUpdateAt: null,
        }
    }
}

export async function getRoomExecutionTruthSnapshot(input: {
    roomId: string
}): Promise<RoomExecutionTruthSnapshot> {
    const room = await roomRepository.findRoomById(input.roomId)
    if (!room) {
        throw new Error(`Room ${input.roomId} does not exist`)
    }

    const paths = getRoomPaths(input.roomId)

    const [runtimeMetadataFile, runtimeHealthFile, runtimeConfigFile] = await Promise.all([
        readJsonFile(paths.runtimeMetadataPath, runtimeFileMetadataSchema),
        readJsonFile(paths.runtimeHealthPath, runtimeHealthFileSchema),
        readJsonFile(paths.runtimeConfigPath, runtimeConfigFileSchema),
    ])

    const sessionsPath =
        runtimeConfigFile?.paths?.sessionsDir ?? join(paths.engineStateDir, 'sessions')
    const memoryPath =
        runtimeConfigFile?.paths?.internalStateDir ?? join(paths.engineStateDir, 'internal-state')
    const [memoryExists, sessionsExists, sessionsSnapshot] = await Promise.all([
        fileExists(memoryPath),
        fileExists(sessionsPath),
        collectSessionDirSnapshot(sessionsPath),
    ])

    const agents: RoomAgentExecutionTruth[] = [
        {
            agentId: 'main',
            workspacePath: runtimeConfigFile?.paths?.workspaceDir ?? paths.workspaceDir,
            memoryPath,
            sessionsPath,
            memoryExists,
            sessionsExists,
            sessionFileCount: sessionsSnapshot.count,
            latestSessionUpdateAt: sessionsSnapshot.latestUpdateAt,
        },
    ]

    return {
        roomId: input.roomId,
        stateDirPath: paths.engineStateDir,
        workspaceDirPath: paths.workspaceDir,
        storeDirPath: paths.storeDir,
        runtimeConfigPath: paths.runtimeConfigPath,
        runtimeMetadataPath: paths.runtimeMetadataPath,
        runtimeHealthPath: paths.runtimeHealthPath,
        runtimeMetadataFile: runtimeMetadataFile
            ? {
                  port: toNullableNumber(runtimeMetadataFile.port),
                  pid: toNullableNumber(runtimeMetadataFile.pid),
                  sandboxUid: toNullableNumber(runtimeMetadataFile.sandbox?.uid),
                  sandboxGid: toNullableNumber(runtimeMetadataFile.sandbox?.gid),
                  sandboxUserName: runtimeMetadataFile.sandbox?.userName ?? null,
                  sandboxGroupName: runtimeMetadataFile.sandbox?.groupName ?? null,
                  startedAt: runtimeMetadataFile.startedAt ?? null,
                  configVersion: toNullableNumber(runtimeMetadataFile.configVersion),
                  tokenVersion: toNullableNumber(runtimeMetadataFile.tokenVersion),
              }
            : null,
        runtimeHealthFile: runtimeHealthFile
            ? {
                  healthy: runtimeHealthFile.healthy,
                  message: runtimeHealthFile.message,
                  checkedAt: runtimeHealthFile.checkedAt,
              }
            : null,
        runtimeConfigFile: runtimeConfigFile
            ? {
                  bind: runtimeConfigFile.runtime?.bindHost ?? null,
                  port: toNullableNumber(runtimeConfigFile.runtime?.port),
                  workspace: runtimeConfigFile.paths?.workspaceDir ?? null,
              }
            : null,
        agents,
    }
}
