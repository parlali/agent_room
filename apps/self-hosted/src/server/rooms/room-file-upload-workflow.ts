import { z } from 'zod'
import {
    roomFileUploadPolicy,
    RoomFileUploadPolicyError,
    totalRoomUploadBytes,
    validateRoomFileUpload,
} from '#/domain/room-file-upload-policy'
import type { RoomRecord } from '#/domain/domain-types'
import type { RoomFileEntry, RoomFileSurface } from '#/domain/room-file-types'
import type { AgentRoomHostedEnv } from '#/server/cloudflare/bindings'
import {
    deleteHostedRoomIndexedFile,
    writeHostedRoomUploadedFile,
} from '#/server/cloudflare/hosted-file-store'
import { getHostedRuntimeState } from '#/server/cloudflare/hosted-room-service'
import { requestHostedPiRuntime } from '#/server/cloudflare/hosted-runtime-client'
import { logPerformanceEvent } from '#/server/telemetry/performance'
import { publishRoomFileChanged } from './execution-engine'

const roomIdSchema = z.string().uuid()

type UploadedRoomFile = RoomFileEntry
type HostedUploadedRoomFile = Awaited<ReturnType<typeof writeHostedRoomUploadedFile>>

type UploadFailureStage =
    | 'parse_room'
    | 'load_runtime_state'
    | 'parse_form'
    | 'validate_files'
    | 'write_files'
    | 'materialize_files'
    | 'publish_events'

interface UploadLogContext {
    roomId: string | null
    fileCount: number | null
    totalBytes: number | null
    surface: RoomFileSurface | null
    sessionAttachment: boolean | null
}

interface HostedUploadContext {
    env: AgentRoomHostedEnv
    workspaceId: string
}

const hostedRuntimeFileMaterializeResponseSchema = z.object({
    ok: z.literal(true),
})

const hostedRuntimeFileDeleteResponseSchema = z.object({
    ok: z.literal(true),
})

function isUploadedFile(value: FormDataEntryValue): value is File {
    return (
        typeof value === 'object' &&
        value !== null &&
        'arrayBuffer' in value &&
        'name' in value &&
        'size' in value
    )
}

function stringField(form: FormData, key: string): string {
    const value = form.get(key)
    return typeof value === 'string' ? value.trim() : ''
}

async function materializeHostedUploadedFile(input: {
    env: AgentRoomHostedEnv
    workspaceId: string
    roomId: string
    file: HostedUploadedRoomFile
    content: Uint8Array
}): Promise<void> {
    await requestHostedPiRuntime({
        env: input.env,
        workspaceId: input.workspaceId,
        roomId: input.roomId,
        path: '/files/materialize',
        schema: hostedRuntimeFileMaterializeResponseSchema,
        body: {
            surface: input.file.surface,
            relativePath: input.file.relativePath,
            contentBase64: Buffer.from(input.content).toString('base64url'),
            mode: 0o600,
        },
    })
}

async function rollbackHostedUploadedFiles(input: {
    env: AgentRoomHostedEnv
    workspaceId: string
    roomId: string
    files: HostedUploadedRoomFile[]
    materializedFiles: HostedUploadedRoomFile[]
}): Promise<void> {
    const errors = []
    const materializedKeys = new Set(
        input.materializedFiles.map((file) => `${file.surface}:${file.relativePath}`),
    )
    const deletedRuntimeKeys = new Set<string>()
    for (const file of [...input.materializedFiles].reverse()) {
        const key = `${file.surface}:${file.relativePath}`
        try {
            await requestHostedPiRuntime({
                env: input.env,
                workspaceId: input.workspaceId,
                roomId: input.roomId,
                path: '/files/delete',
                schema: hostedRuntimeFileDeleteResponseSchema,
                body: {
                    surface: file.surface,
                    relativePath: file.relativePath,
                },
            })
            deletedRuntimeKeys.add(key)
        } catch (error) {
            errors.push(error)
        }
    }
    for (const file of input.files) {
        const key = `${file.surface}:${file.relativePath}`
        if (materializedKeys.has(key) && !deletedRuntimeKeys.has(key)) {
            continue
        }
        try {
            await deleteHostedRoomIndexedFile({
                env: input.env,
                workspaceId: input.workspaceId,
                roomId: input.roomId,
                surface: file.surface,
                relativePath: file.relativePath,
            })
        } catch (error) {
            errors.push(error)
        }
    }
    if (errors.length > 0) {
        throw new AggregateError(errors, 'Hosted upload rollback failed')
    }
}

function attachmentDirectory(sessionKey: string): string {
    const safeSessionKey = sessionKey.replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '')
    if (!safeSessionKey) {
        throw new Error('Attachment session key is invalid')
    }
    return `attachments/${safeSessionKey}/${new Date().toISOString().replace(/[:.]/g, '-')}`
}

function errorCode(error: unknown): string | null {
    if (error instanceof Error && 'code' in error) {
        const code = error.code
        return typeof code === 'string' ? code : null
    }
    return null
}

function uploadFailureReason(error: unknown): string {
    if (error instanceof RoomFileUploadPolicyError) {
        return error.code
    }
    const message = error instanceof Error ? error.message : ''
    if (/Uploaded file name is invalid/.test(message)) return 'invalid_file_name'
    if (/File already exists/.test(message)) return 'file_exists'
    if (/Upload target is not a directory/.test(message)) return 'target_not_directory'
    if (/Uploads cannot target internal store paths/.test(message)) return 'internal_store_path'
    if (/File path escapes|outside shell-writable roots/.test(message)) return 'path_boundary'
    if (/formData|multipart|body|aborted|terminated|cancel/i.test(message)) {
        return 'request_body_unreadable'
    }
    return 'unexpected_error'
}

function uploadFailureMessage(error: unknown): string {
    return error instanceof Error ? error.message : 'Upload failed'
}

function logUploadFailure(input: {
    stage: UploadFailureStage
    context: UploadLogContext
    error: unknown
}) {
    logPerformanceEvent('room_file.upload_failed', {
        stage: input.stage,
        reason: uploadFailureReason(input.error),
        errorName: input.error instanceof Error ? input.error.name : typeof input.error,
        errorCode: errorCode(input.error),
        roomIdPresent: input.context.roomId !== null,
        fileCount: input.context.fileCount,
        totalBytes: input.context.totalBytes,
        surface: input.context.surface,
        sessionAttachment: input.context.sessionAttachment,
        maxFilesPerRequest: roomFileUploadPolicy.maxFilesPerRequest,
        maxBytesPerFile: roomFileUploadPolicy.maxBytesPerFile,
        maxBytesPerRequest: roomFileUploadPolicy.maxBytesPerRequest,
    })
}

async function readHostedRuntimeStarted(input: HostedUploadContext & { roomId: string }) {
    const state = await getHostedRuntimeState(input)
    return Boolean(state?.row.startedAt)
}

async function saveUploadedFile(input: {
    hosted: HostedUploadContext | null
    roomId: string
    surface: RoomFileSurface
    relativeDirectory: string
    file: File
}): Promise<{ file: UploadedRoomFile; content: Uint8Array }> {
    const content = new Uint8Array(await input.file.arrayBuffer())
    if (input.hosted) {
        return {
            file: await writeHostedRoomUploadedFile({
                env: input.hosted.env,
                workspaceId: input.hosted.workspaceId,
                roomId: input.roomId,
                surface: input.surface,
                relativeDirectory: input.relativeDirectory,
                fileName: input.file.name,
                content,
            }),
            content,
        }
    }
    const { writeRoomUploadedFile } = await import('./file-store')
    return {
        file: await writeRoomUploadedFile({
            roomId: input.roomId,
            surface: input.surface,
            relativeDirectory: input.relativeDirectory,
            fileName: input.file.name,
            content: Buffer.from(content),
        }),
        content,
    }
}

async function publishUploadedFiles(input: {
    roomId: string
    sessionKey: string | null
    files: UploadedRoomFile[]
}) {
    await Promise.all(
        input.files.map((file) =>
            publishRoomFileChanged({
                roomId: input.roomId,
                sessionKey: input.sessionKey,
                runId: null,
                surface: file.surface,
                relativePath: file.relativePath,
                operation: 'upload',
                byteLength: file.byteLength,
                changedAt: Date.now(),
            }).catch((error: unknown) => {
                console.warn(
                    error instanceof Error
                        ? `Room file live update publish failed: ${error.message}`
                        : 'Room file live update publish failed',
                )
            }),
        ),
    )
}

export async function uploadRoomFilesFromRequest(input: {
    request: Request
    room: Pick<RoomRecord, 'id'>
    hosted: HostedUploadContext | null
}): Promise<Response> {
    let stage: UploadFailureStage = 'parse_room'
    const logContext: UploadLogContext = {
        roomId: null,
        fileCount: null,
        totalBytes: null,
        surface: null,
        sessionAttachment: null,
    }
    const hostedUploaded: HostedUploadedRoomFile[] = []
    const hostedMaterialized: HostedUploadedRoomFile[] = []

    try {
        const roomId = roomIdSchema.parse(input.room.id)
        logContext.roomId = roomId
        stage = 'load_runtime_state'
        const hostedRuntimeStarted = input.hosted
            ? await readHostedRuntimeStarted({
                  ...input.hosted,
                  roomId,
              })
            : false

        stage = 'parse_form'
        const form = await input.request.formData()
        stage = 'validate_files'
        const files = form.getAll('files').filter(isUploadedFile)
        logContext.fileCount = files.length
        logContext.totalBytes = totalRoomUploadBytes(files)
        validateRoomFileUpload(files)

        const sessionKey = stringField(form, 'sessionKey')
        const surfaceField = stringField(form, 'surface')
        const surface: RoomFileSurface = sessionKey
            ? 'store'
            : surfaceField === 'workspace'
              ? 'workspace'
              : 'store'
        const relativeDirectory = sessionKey
            ? attachmentDirectory(sessionKey)
            : stringField(form, 'path')
        logContext.surface = surface
        logContext.sessionAttachment = Boolean(sessionKey)

        stage = 'write_files'
        const uploaded: UploadedRoomFile[] = []
        for (const file of files) {
            const saved = await saveUploadedFile({
                hosted: input.hosted,
                roomId,
                surface,
                relativeDirectory,
                file,
            })
            uploaded.push(saved.file)
            if (input.hosted) {
                hostedUploaded.push(saved.file)
                if (hostedRuntimeStarted) {
                    stage = 'materialize_files'
                    await materializeHostedUploadedFile({
                        env: input.hosted.env,
                        workspaceId: input.hosted.workspaceId,
                        roomId,
                        file: saved.file,
                        content: saved.content,
                    })
                    hostedMaterialized.push(saved.file)
                    stage = 'write_files'
                }
            }
        }
        stage = 'publish_events'
        await publishUploadedFiles({
            roomId,
            sessionKey: sessionKey || null,
            files: uploaded,
        })

        return Response.json(
            {
                files: uploaded,
            },
            {
                headers: {
                    'cache-control': 'no-store',
                },
            },
        )
    } catch (error) {
        let reportedError = error
        if (input.hosted && logContext.roomId && hostedUploaded.length > 0) {
            try {
                await rollbackHostedUploadedFiles({
                    env: input.hosted.env,
                    workspaceId: input.hosted.workspaceId,
                    roomId: logContext.roomId,
                    files: hostedUploaded,
                    materializedFiles: hostedMaterialized,
                })
            } catch (rollbackError) {
                reportedError = new AggregateError(
                    [error, rollbackError],
                    'Hosted upload materialization and rollback failed',
                )
            }
        }
        logUploadFailure({
            stage,
            context: logContext,
            error: reportedError,
        })
        return new Response(uploadFailureMessage(reportedError), {
            status: 400,
            headers: {
                'cache-control': 'no-store',
                'content-type': 'text/plain; charset=utf-8',
            },
        })
    }
}
