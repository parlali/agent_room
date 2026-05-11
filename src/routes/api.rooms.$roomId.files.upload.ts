import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { assertApiSameOriginMutation, requireApiSession } from '#/server/auth/api-session'
import { roomRepository } from '#/server/db/repositories'
import { writeRoomUploadedFile, type RoomFileSurface } from '#/server/rooms/file-store'

const maxFilesPerUpload = 10
const maxTotalUploadBytes = 100 * 1024 * 1024
const roomIdSchema = z.string().uuid()

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

                try {
                    const roomId = roomIdSchema.parse(params.roomId)
                    const room = await roomRepository.findRoomById(roomId)
                    if (!room) {
                        return new Response('Room not found', {
                            status: 404,
                        })
                    }

                    const form = await request.formData()
                    const files = form.getAll('files').filter(isUploadedFile)
                    if (files.length === 0) {
                        return new Response('No files were uploaded', {
                            status: 400,
                        })
                    }
                    if (files.length > maxFilesPerUpload) {
                        return new Response(`Upload is limited to ${maxFilesPerUpload} files`, {
                            status: 400,
                        })
                    }

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
                    const totalBytes = files.reduce((sum, file) => sum + file.size, 0)
                    if (totalBytes > maxTotalUploadBytes) {
                        return new Response(
                            `Upload is limited to ${maxTotalUploadBytes} bytes per request`,
                            {
                                status: 400,
                            },
                        )
                    }

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
                    return new Response(error instanceof Error ? error.message : 'Upload failed', {
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
