import { Buffer } from 'node:buffer'
import type {
    RoomDirectoryListing,
    RoomFileEntry,
    RoomFilePreview,
    RoomFilePreviewAsset,
    RoomFileSurface,
    RoomFileTree,
    RoomFileTreeNode,
} from '#/domain/room-file-types'
import { isImageMediaType, isOfficePath, isTextMediaType, mediaTypeFor } from '../rooms/file-media'
import {
    normalizeRoomFileRelativePath,
    parentRoomFilePath,
    roomFileBreadcrumbs,
} from '../rooms/file-paths'
import type { AgentRoomHostedEnv } from './bindings'
import { assertHostedFileVisible } from './hosted-file-store'

const maxPreviewBytes = 512000
const maxTreeEntries = 500

export interface HostedRoomFileMaterialization {
    surface: RoomFileSurface
    relativePath: string
    contentBase64: string
    mode: number
}

export async function listHostedRoomFileMaterializations(input: {
    env: AgentRoomHostedEnv
    workspaceId: string
    roomId: string
}): Promise<HostedRoomFileMaterialization[]> {
    const rows = (await listIndexedFiles(input)).filter((row) => row.kind === 'file')
    const materializations: HostedRoomFileMaterialization[] = []
    for (const row of rows) {
        const surface = row.surface as RoomFileSurface
        assertHostedFileVisible({
            surface,
            relativePath: row.relativePath,
        })
        const object = await input.env.AGENT_ROOM_WORKSPACE_BUCKET.get(row.objectKey)
        if (!object) {
            throw new Error(`Hosted file object is missing for ${surface}:${row.relativePath}`)
        }
        materializations.push({
            surface,
            relativePath: row.relativePath,
            contentBase64: Buffer.from(await object.arrayBuffer()).toString('base64url'),
            mode: 0o600,
        })
    }
    return materializations
}

async function listIndexedFiles(input: {
    env: AgentRoomHostedEnv
    workspaceId: string
    roomId: string
}): Promise<HostedFileRow[]> {
    await assertHostedFileRoomExists(input)
    const rows = await input.env.AGENT_ROOM_DB.prepare(
        `
            SELECT
                surface,
                relative_path AS relativePath,
                object_key AS objectKey,
                kind,
                byte_length AS byteLength,
                media_type AS mediaType,
                updated_at AS updatedAt
            FROM hosted_room_file_index
            WHERE workspace_id = ?1
              AND room_id = ?2
            ORDER BY surface, relative_path
        `,
    )
        .bind(input.workspaceId, input.roomId)
        .all<HostedFileRow>()
    return rows.results
}

async function assertHostedFileRoomExists(input: {
    env: AgentRoomHostedEnv
    workspaceId: string
    roomId: string
}): Promise<void> {
    const row = await input.env.AGENT_ROOM_DB.prepare(
        `
            SELECT 1 AS present
            FROM hosted_room
            WHERE workspace_id = ?1
              AND id = ?2
            LIMIT 1
        `,
    )
        .bind(input.workspaceId, input.roomId)
        .first<{ present: number }>()
    if (!row) {
        throw new Error('Room not found')
    }
}

function entryFromRow(row: HostedFileRow): RoomFileEntry {
    return {
        name: row.relativePath.split('/').filter(Boolean).at(-1) ?? row.relativePath,
        relativePath: row.relativePath,
        surface: row.surface as RoomFileSurface,
        kind: row.kind as RoomFileEntry['kind'],
        byteLength: row.byteLength,
        updatedAt: row.updatedAt,
    }
}

export async function listHostedRoomFiles(input: {
    env: AgentRoomHostedEnv
    workspaceId: string
    roomId: string
}): Promise<RoomFileEntry[]> {
    return (await listIndexedFiles(input)).map(entryFromRow)
}

export async function listHostedRoomDirectory(input: {
    env: AgentRoomHostedEnv
    workspaceId: string
    roomId: string
    surface: RoomFileSurface
    relativePath?: string | null
}): Promise<RoomDirectoryListing> {
    const relativePath = normalizeRoomFileRelativePath(input.relativePath)
    assertHostedFileVisible({
        surface: input.surface,
        relativePath,
    })
    const rows = (await listIndexedFiles(input)).filter((row) => row.surface === input.surface)
    const prefix = relativePath ? `${relativePath}/` : ''
    const entries = rows
        .filter((row) => {
            if (relativePath && row.relativePath === relativePath) {
                return false
            }
            if (!row.relativePath.startsWith(prefix)) {
                return false
            }
            return !row.relativePath.slice(prefix.length).includes('/')
        })
        .map(entryFromRow)
    return {
        surface: input.surface,
        relativePath,
        parentPath: parentRoomFilePath(relativePath),
        breadcrumbs: roomFileBreadcrumbs(relativePath),
        entries,
    }
}

export async function listHostedRoomFileTree(input: {
    env: AgentRoomHostedEnv
    workspaceId: string
    roomId: string
}): Promise<RoomFileTree> {
    const rows = (await listIndexedFiles(input)).filter((row) => row.kind === 'directory')
    function children(surface: RoomFileSurface, parent: string): RoomFileTreeNode[] {
        const prefix = parent ? `${parent}/` : ''
        return rows
            .filter((row) => row.surface === surface && row.relativePath.startsWith(prefix))
            .filter((row) => !row.relativePath.slice(prefix.length).includes('/'))
            .slice(0, maxTreeEntries)
            .map((row) => ({
                name: row.relativePath.split('/').at(-1) ?? row.relativePath,
                relativePath: row.relativePath,
                surface,
                children: children(surface, row.relativePath),
                truncated: false,
            }))
    }
    return {
        roots: [
            {
                name: 'Workspace',
                relativePath: '',
                surface: 'workspace',
                children: children('workspace', ''),
                truncated: rows.length >= maxTreeEntries,
            },
            {
                name: 'Uploads',
                relativePath: '',
                surface: 'store',
                children: children('store', ''),
                truncated: rows.length >= maxTreeEntries,
            },
        ],
    }
}

async function readFileRow(input: {
    env: AgentRoomHostedEnv
    workspaceId: string
    roomId: string
    surface: RoomFileSurface
    relativePath: string
}): Promise<HostedFileRow> {
    await assertHostedFileRoomExists(input)
    const relativePath = normalizeRoomFileRelativePath(input.relativePath)
    assertHostedFileVisible({
        surface: input.surface,
        relativePath,
    })
    const row = await input.env.AGENT_ROOM_DB.prepare(
        `
            SELECT
                surface,
                relative_path AS relativePath,
                object_key AS objectKey,
                kind,
                byte_length AS byteLength,
                media_type AS mediaType,
                updated_at AS updatedAt
            FROM hosted_room_file_index
            WHERE workspace_id = ?1
              AND room_id = ?2
              AND surface = ?3
              AND relative_path = ?4
              AND kind = 'file'
        `,
    )
        .bind(input.workspaceId, input.roomId, input.surface, relativePath)
        .first<HostedFileRow>()
    if (!row) {
        throw new Error('File not found')
    }
    return row
}

export async function readHostedRoomFileContent(input: {
    env: AgentRoomHostedEnv
    workspaceId: string
    roomId: string
    surface: RoomFileSurface
    relativePath: string
}): Promise<RoomFilePreview> {
    const row = await readFileRow(input)
    const mediaType = row.mediaType ?? mediaTypeFor(row.relativePath)
    const name = row.relativePath.split('/').at(-1) ?? row.relativePath
    if (isTextMediaType(mediaType)) {
        const object = await input.env.AGENT_ROOM_WORKSPACE_BUCKET.get(row.objectKey, {
            range: {
                offset: 0,
                length: maxPreviewBytes + 1,
            },
        })
        if (!object) {
            throw new Error('File object not found')
        }
        const content = await object.text()
        return {
            kind: 'text',
            name,
            relativePath: row.relativePath,
            surface: input.surface,
            mediaType,
            encoding: 'utf8',
            content: content.slice(0, maxPreviewBytes),
            byteLength: row.byteLength ?? content.length,
            truncated: content.length > maxPreviewBytes,
            generated: false,
        }
    }
    if (isImageMediaType(mediaType) || mediaType === 'application/pdf') {
        return {
            kind: mediaType === 'application/pdf' ? 'pdf' : 'image',
            name,
            relativePath: row.relativePath,
            surface: input.surface,
            mediaType,
            byteLength: row.byteLength ?? 0,
            truncated: false,
            generated: false,
        }
    }
    return {
        kind: 'unsupported',
        name,
        relativePath: row.relativePath,
        surface: input.surface,
        mediaType,
        byteLength: row.byteLength ?? 0,
        reason: 'Preview is not available for this file type',
    }
}

export async function readHostedRoomFileByteLength(input: {
    env: AgentRoomHostedEnv
    workspaceId: string
    roomId: string
    surface: RoomFileSurface
    relativePath: string
}): Promise<number> {
    const row = await readFileRow(input)
    return row.byteLength ?? 0
}

function clampByteRange(
    byteRange: { start: number; end: number } | null | undefined,
    byteLength: number,
): { start: number; end: number } | null {
    if (!byteRange || !Number.isSafeInteger(byteLength) || byteLength <= 0) {
        return null
    }
    const requestedStart = Number.isSafeInteger(byteRange.start) ? byteRange.start : 0
    const requestedEnd = Number.isSafeInteger(byteRange.end) ? byteRange.end : byteLength - 1
    const start = Math.max(0, Math.min(requestedStart, byteLength - 1))
    const end = Math.max(start, Math.min(requestedEnd, byteLength - 1))
    return { start, end }
}

export async function readHostedRoomFileAsset(input: {
    env: AgentRoomHostedEnv
    workspaceId: string
    roomId: string
    surface: RoomFileSurface
    relativePath: string
    byteRange?: { start: number; end: number } | null
}): Promise<RoomFilePreviewAsset> {
    const row = await readFileRow(input)
    const byteLength = row.byteLength ?? 0
    const byteRange = clampByteRange(input.byteRange, byteLength)
    const rangeOption = byteRange
        ? {
              range: {
                  offset: byteRange.start,
                  length: byteRange.end - byteRange.start + 1,
              },
          }
        : undefined
    const object = await input.env.AGENT_ROOM_WORKSPACE_BUCKET.get(row.objectKey, rangeOption)
    if (!object) {
        throw new Error('File object not found')
    }
    const content = new Uint8Array(await object.arrayBuffer())
    return {
        name: row.relativePath.split('/').at(-1) ?? row.relativePath,
        relativePath: row.relativePath,
        surface: input.surface,
        mediaType: row.mediaType ?? mediaTypeFor(row.relativePath),
        byteLength,
        content: Buffer.from(content),
        generated: false,
    }
}

export async function readHostedRoomFilePreviewAsset(input: {
    env: AgentRoomHostedEnv
    workspaceId: string
    roomId: string
    surface: RoomFileSurface
    relativePath: string
    byteRange?: { start: number; end: number } | null
}): Promise<RoomFilePreviewAsset> {
    const row = await readFileRow(input)
    const mediaType = row.mediaType ?? mediaTypeFor(row.relativePath)
    if (isOfficePath(row.relativePath)) {
        throw new Error('Hosted Office document previews are not available')
    }
    if (!isImageMediaType(mediaType) && mediaType !== 'application/pdf') {
        throw new Error('Preview is not available for this file type')
    }
    return readHostedRoomFileAsset(input)
}

interface HostedFileRow {
    surface: string
    relativePath: string
    objectKey: string
    kind: string
    byteLength: number | null
    mediaType: string | null
    updatedAt: string | null
}
