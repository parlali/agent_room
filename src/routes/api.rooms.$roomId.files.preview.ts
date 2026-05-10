import { createFileRoute } from '@tanstack/react-router'
import { requireApiSession } from '#/server/auth/api-session'
import { readRoomFilePreviewAsset } from '#/server/rooms/file-store'

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
                const surface = url.searchParams.get('surface')
                const relativePath = url.searchParams.get('path')
                if (surface !== 'workspace' && surface !== 'store') {
                    return new Response('Invalid file surface', {
                        status: 400,
                    })
                }
                if (!relativePath) {
                    return new Response('Missing file path', {
                        status: 400,
                    })
                }

                try {
                    const preview = await readRoomFilePreviewAsset({
                        roomId: params.roomId,
                        surface,
                        relativePath,
                    })
                    const body = new Uint8Array(preview.content)
                    return new Response(body, {
                        headers: {
                            'content-type': preview.mediaType,
                            'content-length': String(preview.byteLength),
                            'cache-control': 'no-store',
                            'content-disposition': `inline; filename="${contentDispositionFilename(preview.name)}"`,
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
