import { createFileRoute } from '@tanstack/react-router'
import { createReadStream } from 'node:fs'
import { Readable } from 'node:stream'
import { requireApiSession } from '#/server/auth/api-session'
import {
    resolveRoomFileDownloadAsset,
    resolveRoomFilePreviewAsset,
    type RoomFileSurface,
} from '#/server/rooms/file-store'

function contentDispositionFilename(name: string): string {
    return name.replace(/["\r\n]/g, '_')
}

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
                    const body = Readable.toWeb(
                        createReadStream(asset.path),
                    ) as ReadableStream<Uint8Array>
                    return new Response(body, {
                        headers: {
                            'content-type': asset.mediaType,
                            'content-length': String(asset.byteLength),
                            'cache-control': 'no-store',
                            'content-disposition': `${download ? 'attachment' : 'inline'}; filename="${contentDispositionFilename(asset.name)}"`,
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
