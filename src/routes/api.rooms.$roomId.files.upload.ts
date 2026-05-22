import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import {
    roomFileUploadPolicy,
    RoomFileUploadPolicyError,
    totalRoomUploadBytes,
    validateRoomFileUpload,
} from '#/lib/room-file-upload-policy'
import { assertApiSameOriginMutation, requireApiSession } from '#/server/auth/api-session'
import { roomRepository } from '#/server/db/repositories'
import { writeRoomUploadedFile, type RoomFileSurface } from '#/server/rooms/file-store'
import { publishRoomFileChanged } from '#/server/rooms/execution-engine'
import { logPerformanceEvent } from '#/server/telemetry/performance'

const roomIdSchema = z.string().uuid()
type UploadFailureStage =
    | 'parse_room'
    | 'load_room'
    | 'parse_form'
    | 'validate_files'
    | 'write_files'
    | 'publish_events'

interface UploadLogContext {
    roomId: string | null
    fileCount: number | null
    totalBytes: number | null
    surface: RoomFileSurface | null
    sessionAttachment: boolean | null
}

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
        roomId: input.context.roomId,
        stage: input.stage,
        reason: uploadFailureReason(input.error),
        errorName: input.error instanceof Error ? input.error.name : typeof input.error,
        errorCode: errorCode(input.error),
        fileCount: input.context.fileCount,
        totalBytes: input.context.totalBytes,
        surface: input.context.surface,
        sessionAttachment: input.context.sessionAttachment,
        maxFilesPerRequest: roomFileUploadPolicy.maxFilesPerRequest,
        maxBytesPerFile: roomFileUploadPolicy.maxBytesPerFile,
        maxBytesPerRequest: roomFileUploadPolicy.maxBytesPerRequest,
    })
}

export const Route = createFileRoute('/api/rooms/$roomId/files/upload')({
    server: {
        handlers: {
            POST: async ({ request, params }) => {
                if (!(await requireApiSession(request))) {
                    return new Response('Authentication required', {
                        status: 401,
                    })
                }

                const originError = assertApiSameOriginMutation(request)
                if (originError) {
                    return originError
                }

                let stage: UploadFailureStage = 'parse_room'
                const logContext: UploadLogContext = {
                    roomId: null,
                    fileCount: null,
                    totalBytes: null,
                    surface: null,
                    sessionAttachment: null,
                }

                try {
                    const roomId = roomIdSchema.parse(params.roomId)
                    logContext.roomId = roomId
                    stage = 'load_room'
                    const room = await roomRepository.findRoomById(roomId)
                    if (!room) {
                        return new Response('Room not found', {
                            status: 404,
                        })
                    }

                    stage = 'parse_form'
                    const form = await request.formData()
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
                    const uploaded = []
                    for (const file of files) {
                        uploaded.push(
                            await writeRoomUploadedFile({
                                roomId,
                                surface,
                                relativeDirectory,
                                fileName: file.name,
                                content: Buffer.from(await file.arrayBuffer()),
                            }),
                        )
                    }
                    stage = 'publish_events'
                    await Promise.all(
                        uploaded.map((file) =>
                            publishRoomFileChanged({
                                roomId,
                                sessionKey: sessionKey || null,
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
                    logUploadFailure({
                        stage,
                        context: logContext,
                        error,
                    })
                    return new Response(uploadFailureMessage(error), {
                        status: 400,
                        headers: {
                            'cache-control': 'no-store',
                            'content-type': 'text/plain; charset=utf-8',
                        },
                    })
                }
            },
        },
    },
})
