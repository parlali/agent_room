import { createReadStream } from 'node:fs'
import { Readable } from 'node:stream'
import type { RoomFileSurface } from '#/domain/room-file-types'
import type { AgentRoomHostedEnv } from '#/server/cloudflare/bindings'
import {
    readHostedRoomFileAsset,
    readHostedRoomFileByteLength,
    readHostedRoomFilePreviewAsset,
} from '#/server/cloudflare/hosted-file-read-store'
import { contentDispositionHeader } from '#/server/http/content-disposition'
import { resolveHttpByteRange } from '#/server/http/byte-range'
import { resolveRoomFileDownloadAsset, resolveRoomFilePreviewAsset } from './file-store-preview'

interface HostedPreviewContext {
    env: AgentRoomHostedEnv
    workspaceId: string
}

interface PreviewAssetInput {
    roomId: string
    surface: RoomFileSurface
    relativePath: string
}

interface PreviewResponseInput {
    request: Request
    roomId: string
    hosted: HostedPreviewContext | null
}

interface ResolvedPreviewBody {
    body: BodyInit
    name: string
    mediaType: string
    byteLength: number
    contentLength: number
    byteRange: { start: number; end: number; contentLength: number } | null
}

function parsePreviewRequest(request: Request): {
    surface: RoomFileSurface
    relativePath: string
    downloadOriginal: boolean
    downloadPreview: boolean
} {
    const url = new URL(request.url)
    const surfaceValue = url.searchParams.get('surface')
    const relativePath = url.searchParams.get('path')
    if (surfaceValue !== 'workspace' && surfaceValue !== 'store') {
        throw new Response('Invalid file surface', {
            status: 400,
        })
    }
    if (!relativePath) {
        throw new Response('Missing file path', {
            status: 400,
        })
    }
    const downloadParam = url.searchParams.get('download')
    return {
        surface: surfaceValue,
        relativePath,
        downloadOriginal: downloadParam === '1',
        downloadPreview: downloadParam === 'preview',
    }
}

function unsatisfiableRangeResponse(byteLength: number): Response {
    return new Response(null, {
        status: 416,
        headers: {
            'accept-ranges': 'bytes',
            'cache-control': 'no-store',
            'content-range': `bytes */${byteLength}`,
        },
    })
}

function responseForResolvedPreview(input: {
    resolved: ResolvedPreviewBody
    download: boolean
}): Response {
    const byteRange = input.resolved.byteRange
    return new Response(input.resolved.body, {
        status: byteRange ? 206 : 200,
        headers: {
            'accept-ranges': 'bytes',
            'content-type': input.resolved.mediaType,
            'content-length': String(input.resolved.contentLength),
            'cache-control': 'no-store',
            'content-disposition': contentDispositionHeader({
                disposition: input.download ? 'attachment' : 'inline',
                filename: input.resolved.name,
            }),
            ...(byteRange
                ? {
                      'content-range': `bytes ${byteRange.start}-${byteRange.end}/${input.resolved.byteLength}`,
                  }
                : {}),
            'x-content-type-options': 'nosniff',
        },
    })
}

async function resolveHostedPreviewBody(input: {
    request: Request
    hosted: HostedPreviewContext
    asset: PreviewAssetInput
    downloadOriginal: boolean
}): Promise<ResolvedPreviewBody | Response> {
    const hostedAssetInput = {
        env: input.hosted.env,
        workspaceId: input.hosted.workspaceId,
        ...input.asset,
    }
    const byteLength = await readHostedRoomFileByteLength(hostedAssetInput)
    const rangeResult = resolveHttpByteRange(input.request.headers.get('range'), byteLength)
    if (rangeResult.kind === 'unsatisfiable') {
        return unsatisfiableRangeResponse(byteLength)
    }
    const byteRange = rangeResult.kind === 'satisfiable' ? rangeResult.range : null
    const asset = input.downloadOriginal
        ? await readHostedRoomFileAsset({
              ...hostedAssetInput,
              byteRange,
          })
        : await readHostedRoomFilePreviewAsset({
              ...hostedAssetInput,
              byteRange,
          })
    const contentLength = byteRange ? byteRange.contentLength : byteLength
    return {
        body: asset.content.buffer.slice(
            asset.content.byteOffset,
            asset.content.byteOffset + asset.content.byteLength,
        ) as ArrayBuffer,
        name: asset.name,
        mediaType: asset.mediaType,
        byteLength,
        contentLength,
        byteRange,
    }
}

async function resolveLocalPreviewBody(input: {
    request: Request
    asset: PreviewAssetInput
    downloadOriginal: boolean
}): Promise<ResolvedPreviewBody | Response> {
    const asset = input.downloadOriginal
        ? await resolveRoomFileDownloadAsset(input.asset)
        : await resolveRoomFilePreviewAsset(input.asset)
    const rangeResult = resolveHttpByteRange(input.request.headers.get('range'), asset.byteLength)
    if (rangeResult.kind === 'unsatisfiable') {
        return unsatisfiableRangeResponse(asset.byteLength)
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
    return {
        body,
        name: asset.name,
        mediaType: asset.mediaType,
        byteLength: asset.byteLength,
        contentLength: byteRange ? byteRange.contentLength : asset.byteLength,
        byteRange,
    }
}

export async function roomFilePreviewResponse(input: PreviewResponseInput): Promise<Response> {
    let parsed: ReturnType<typeof parsePreviewRequest>
    try {
        parsed = parsePreviewRequest(input.request)
    } catch (error) {
        if (error instanceof Response) {
            return error
        }
        throw error
    }

    try {
        const assetInput = {
            roomId: input.roomId,
            surface: parsed.surface,
            relativePath: parsed.relativePath,
        }
        const resolved = input.hosted
            ? await resolveHostedPreviewBody({
                  request: input.request,
                  hosted: input.hosted,
                  asset: assetInput,
                  downloadOriginal: parsed.downloadOriginal,
              })
            : await resolveLocalPreviewBody({
                  request: input.request,
                  asset: assetInput,
                  downloadOriginal: parsed.downloadOriginal,
              })
        if (resolved instanceof Response) {
            return resolved
        }
        return responseForResolvedPreview({
            resolved,
            download: parsed.downloadOriginal || parsed.downloadPreview,
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
}
