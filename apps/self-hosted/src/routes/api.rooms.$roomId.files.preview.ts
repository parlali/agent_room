import { createFileRoute } from '@tanstack/react-router'
import { createReadStream } from 'node:fs'
import { Readable } from 'node:stream'
import { requireApiSession } from '#/server/auth/api-session'
import {
    resolveRoomFileDownloadAsset,
    resolveRoomFilePreviewAsset,
} from '#/server/rooms/file-store-preview'
import { resolveHttpByteRange } from '#/server/http/byte-range'
import { contentDispositionHeader } from '#/server/http/content-disposition'
import type { RoomFileSurface } from '#/domain/room-file-types'

export const Route = createFileRoute('/api/rooms/$roomId/files/preview')({
    server: {
        handlers: {
            GET: async ({ request, params }) => {
                if (!(await requireApiSession(request))) {
                    return new Response('Authentication required', {
                        status: 401,
                    })
                }

                const url = new URL(request.url)
                const surfaceValue = url.searchParams.get('surface')
                const relativePath = url.searchParams.get('path')
                if (surfaceValue !== 'workspace' && surfaceValue !== 'store') {
                    return new Response('Invalid file surface', {
                        status: 400,
                    })
                }
                const surface: RoomFileSurface = surfaceValue
                if (!relativePath) {
                    return new Response('Missing file path', {
                        status: 400,
                    })
                }

                try {
                    const download = url.searchParams.get('download') === '1'
                    const assetInput = {
                        roomId: params.roomId,
                        surface,
                        relativePath,
                    }
                    const asset = download
                        ? await resolveRoomFileDownloadAsset(assetInput)
                        : await resolveRoomFilePreviewAsset(assetInput)
                    const rangeResult = resolveHttpByteRange(
                        request.headers.get('range'),
                        asset.byteLength,
                    )
                    if (rangeResult.kind === 'unsatisfiable') {
                        return new Response(null, {
                            status: 416,
                            headers: {
                                'accept-ranges': 'bytes',
                                'cache-control': 'no-store',
                                'content-range': `bytes */${asset.byteLength}`,
                            },
                        })
                    }
                    const byteRange = rangeResult.kind === 'satisfiable' ? rangeResult.range : null
                    const body = Readable.toWeb(
                        byteRange
                            ? createReadStream(asset.path, {
                                  start: byteRange.start,
                                  end: byteRange.end,
                              })
                            : createReadStream(asset.path),
                    ) as ReadableStream<Uint8Array>
                    const contentLength = byteRange ? byteRange.contentLength : asset.byteLength
                    return new Response(body, {
                        status: byteRange ? 206 : 200,
                        headers: {
                            'accept-ranges': 'bytes',
                            'content-type': asset.mediaType,
                            'content-length': String(contentLength),
                            'cache-control': 'no-store',
                            'content-disposition': contentDispositionHeader({
                                disposition: download ? 'attachment' : 'inline',
                                filename: asset.name,
                            }),
                            ...(byteRange
                                ? {
                                      'content-range': `bytes ${byteRange.start}-${byteRange.end}/${asset.byteLength}`,
                                  }
                                : {}),
                            'x-content-type-options': 'nosniff',
                        },
                    })
                } catch (error) {
                    return new Response(error instanceof Error ? error.message : 'Preview failed', {
                        status: 404,
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
