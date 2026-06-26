import type { RoomFileEntry, RoomFileSurface } from '#/domain/room-file-types'
import {
    formatRoomUploadBytes,
    roomFileUploadPolicy,
    RoomFileUploadPolicyError,
} from '#/domain/room-file-upload-policy'
import type { AgentRoomHostedEnv } from './bindings'
import { assertHostedQuotaAllowed } from './hosted-abuse-controls'
import { hostedRoomFileObjectKey } from './workspace-storage'
import { nowIso } from './hosted-json'
import { sanitizeUploadName } from '../rooms/upload-name'
import { shouldExposeStoreRelativePath } from '../rooms/room-store-visibility'
import { mediaTypeFor } from '../rooms/file-media'
import { joinRoomFileRelativePath, normalizeRoomFileRelativePath } from '../rooms/file-paths'

type HostedD1Statement = ReturnType<AgentRoomHostedEnv['AGENT_ROOM_DB']['prepare']>

function directoryAncestorPaths(relativePath: string): string[] {
    const parts = normalizeRoomFileRelativePath(relativePath).split('/').filter(Boolean)
    return parts.slice(0, -1).map((_, index) => parts.slice(0, index + 1).join('/'))
}

export function assertHostedFileVisible(input: {
    surface: RoomFileSurface
    relativePath: string
}): void {
    if (input.surface === 'store' && !shouldExposeStoreRelativePath(input.relativePath)) {
        throw new Error('Uploads cannot target internal store paths')
    }
}

async function assertNoFileAncestors(input: {
    env: AgentRoomHostedEnv
    workspaceId: string
    roomId: string
    surface: RoomFileSurface
    relativePath: string
}): Promise<void> {
    const ancestors = directoryAncestorPaths(input.relativePath)
    if (ancestors.length === 0) {
        return
    }
    const placeholders = ancestors.map((_, index) => `?${index + 4}`).join(', ')
    const row = await input.env.AGENT_ROOM_DB.prepare(
        `
            SELECT relative_path AS relativePath
            FROM hosted_room_file_index
            WHERE workspace_id = ?1
              AND room_id = ?2
              AND surface = ?3
              AND kind = 'file'
              AND relative_path IN (${placeholders})
            ORDER BY length(relative_path) ASC
            LIMIT 1
        `,
    )
        .bind(input.workspaceId, input.roomId, input.surface, ...ancestors)
        .first<{ relativePath: string }>()
    if (row) {
        throw new Error(`Directory path is already a file: ${row.relativePath}`)
    }
}

function directoryAncestorStatements(input: {
    env: AgentRoomHostedEnv
    workspaceId: string
    roomId: string
    surface: RoomFileSurface
    relativePath: string
    now: string
}): HostedD1Statement[] {
    const ancestors = directoryAncestorPaths(input.relativePath)
    return ancestors.map((relativePath) =>
        input.env.AGENT_ROOM_DB.prepare(
            `
                INSERT INTO hosted_room_file_index (
                    workspace_id,
                    room_id,
                    surface,
                    relative_path,
                    object_key,
                    kind,
                    byte_length,
                    media_type,
                    created_at,
                    updated_at
                )
                VALUES (?1, ?2, ?3, ?4, '', 'directory', NULL, NULL, ?5, ?5)
                ON CONFLICT(workspace_id, room_id, surface, relative_path) DO UPDATE SET
                    updated_at = excluded.updated_at
                WHERE hosted_room_file_index.kind = 'directory'
            `,
        ).bind(input.workspaceId, input.roomId, input.surface, relativePath, input.now),
    )
}

function assertDirectoryAncestorBatchResults(input: {
    relativePath: string
    results: unknown[]
    expectedAncestorCount: number
}): void {
    for (const result of input.results.slice(0, input.expectedAncestorCount)) {
        const changes = (result as { meta?: { changes?: number } }).meta?.changes
        if (changes === undefined || changes < 1) {
            throw new Error(`Directory path is already a file: ${input.relativePath}`)
        }
    }
}

async function deleteHostedFileIndexObject(input: {
    env: AgentRoomHostedEnv
    workspaceId: string
    roomId: string
    objectKey: string
}): Promise<void> {
    await input.env.AGENT_ROOM_DB.prepare(
        `
            DELETE FROM hosted_room_file_index
            WHERE workspace_id = ?1
              AND room_id = ?2
              AND object_key = ?3
              AND kind = 'file'
        `,
    )
        .bind(input.workspaceId, input.roomId, input.objectKey)
        .run()
}

async function deleteHostedRoomFileObjectBestEffort(input: {
    env: AgentRoomHostedEnv
    objectKey: string
    context: string
}): Promise<void> {
    try {
        await input.env.AGENT_ROOM_WORKSPACE_BUCKET.delete(input.objectKey)
    } catch (error) {
        console.warn(
            error instanceof Error
                ? `${input.context}: ${error.message}`
                : `${input.context}: object delete failed`,
        )
    }
}

function hostedRoomFileContentObjectKey(input: {
    workspaceId: string
    roomId: string
    surface: RoomFileSurface
    relativePath: string
}): string {
    return `${hostedRoomFileObjectKey(input)}.${crypto.randomUUID()}`
}

function hostedFileName(relativePath: string): string {
    return relativePath.split('/').filter(Boolean).at(-1) ?? relativePath
}

async function persistHostedRoomFileContent(input: {
    env: AgentRoomHostedEnv
    workspaceId: string
    roomId: string
    surface: RoomFileSurface
    relativePath: string
    name?: string
    content: Uint8Array
    mode: 'insert' | 'upsert'
}): Promise<{ entry: RoomFileEntry; objectKey: string }> {
    const mediaType = mediaTypeFor(input.relativePath)
    const now = nowIso()
    const objectKey = hostedRoomFileContentObjectKey(input)
    await input.env.AGENT_ROOM_WORKSPACE_BUCKET.put(objectKey, input.content, {
        httpMetadata: {
            contentType: mediaType,
        },
    })
    try {
        await assertNoFileAncestors({
            env: input.env,
            workspaceId: input.workspaceId,
            roomId: input.roomId,
            surface: input.surface,
            relativePath: input.relativePath,
        })
        const ancestorStatements = directoryAncestorStatements({
            env: input.env,
            workspaceId: input.workspaceId,
            roomId: input.roomId,
            surface: input.surface,
            relativePath: input.relativePath,
            now,
        })
        const conflictClause =
            input.mode === 'upsert'
                ? `
                    ON CONFLICT(workspace_id, room_id, surface, relative_path) DO UPDATE SET
                        object_key = excluded.object_key,
                        kind = 'file',
                        byte_length = excluded.byte_length,
                        media_type = excluded.media_type,
                        updated_at = excluded.updated_at
                `
                : ''
        const fileStatement = input.env.AGENT_ROOM_DB.prepare(
            `
                INSERT INTO hosted_room_file_index (
                    workspace_id,
                    room_id,
                    surface,
                    relative_path,
                    object_key,
                    kind,
                    byte_length,
                    media_type,
                    created_at,
                    updated_at
                )
                VALUES (?1, ?2, ?3, ?4, ?5, 'file', ?6, ?7, ?8, ?8)
                ${conflictClause}
            `,
        ).bind(
            input.workspaceId,
            input.roomId,
            input.surface,
            input.relativePath,
            objectKey,
            input.content.byteLength,
            mediaType,
            now,
        )
        const results = await input.env.AGENT_ROOM_DB.batch([...ancestorStatements, fileStatement])
        assertDirectoryAncestorBatchResults({
            relativePath: input.relativePath,
            results,
            expectedAncestorCount: ancestorStatements.length,
        })
    } catch (error) {
        await deleteHostedFileIndexObject({
            env: input.env,
            workspaceId: input.workspaceId,
            roomId: input.roomId,
            objectKey,
        })
        await input.env.AGENT_ROOM_WORKSPACE_BUCKET.delete(objectKey)
        if (
            input.mode === 'insert' &&
            error instanceof Error &&
            /constraint|unique/i.test(error.message)
        ) {
            throw new Error(`File already exists: ${input.relativePath}`)
        }
        throw error
    }
    return {
        objectKey,
        entry: {
            name: input.name ?? hostedFileName(input.relativePath),
            relativePath: input.relativePath,
            surface: input.surface,
            kind: 'file',
            byteLength: input.content.byteLength,
            updatedAt: now,
        },
    }
}

export async function writeHostedRoomUploadedFile(input: {
    env: AgentRoomHostedEnv
    workspaceId: string
    roomId: string
    surface: RoomFileSurface
    relativeDirectory?: string | null
    fileName: string
    content: Uint8Array
}): Promise<RoomFileEntry> {
    if (input.content.byteLength > roomFileUploadPolicy.maxBytesPerFile) {
        throw new RoomFileUploadPolicyError(
            'file_too_large',
            `Uploads are limited to ${formatRoomUploadBytes(roomFileUploadPolicy.maxBytesPerFile)} per file`,
        )
    }
    const name = sanitizeUploadName(input.fileName)
    const relativePath = joinRoomFileRelativePath(input.relativeDirectory, name)
    assertHostedFileVisible({
        surface: input.surface,
        relativePath,
    })
    const existing = await input.env.AGENT_ROOM_DB.prepare(
        `
            SELECT 1
            FROM hosted_room_file_index
            WHERE workspace_id = ?1
              AND room_id = ?2
              AND surface = ?3
              AND relative_path = ?4
        `,
    )
        .bind(input.workspaceId, input.roomId, input.surface, relativePath)
        .first()
    if (existing) {
        throw new Error(`File already exists: ${relativePath}`)
    }
    await assertHostedQuotaAllowed({
        env: input.env,
        workspaceId: input.workspaceId,
        roomId: input.roomId,
        action: 'file_upload',
        amount: {
            bytes: input.content.byteLength,
            storageBytes: input.content.byteLength,
        },
    })
    const persisted = await persistHostedRoomFileContent({
        env: input.env,
        workspaceId: input.workspaceId,
        roomId: input.roomId,
        surface: input.surface,
        relativePath,
        name,
        content: input.content,
        mode: 'insert',
    })
    return persisted.entry
}

export async function upsertHostedRoomRuntimeFile(input: {
    env: AgentRoomHostedEnv
    workspaceId: string
    roomId: string
    surface: RoomFileSurface
    relativePath: string
    content: Uint8Array
}): Promise<RoomFileEntry> {
    if (input.content.byteLength > roomFileUploadPolicy.maxBytesPerFile) {
        throw new RoomFileUploadPolicyError(
            'file_too_large',
            `Runtime file sync is limited to ${formatRoomUploadBytes(roomFileUploadPolicy.maxBytesPerFile)} per file`,
        )
    }
    const relativePath = normalizeRoomFileRelativePath(input.relativePath)
    assertHostedFileVisible({
        surface: input.surface,
        relativePath,
    })
    if (!relativePath) {
        throw new Error('Runtime file path cannot be empty')
    }
    const existing = await input.env.AGENT_ROOM_DB.prepare(
        `
            SELECT object_key AS objectKey,
                   kind,
                   byte_length AS byteLength
            FROM hosted_room_file_index
            WHERE workspace_id = ?1
              AND room_id = ?2
              AND surface = ?3
              AND relative_path = ?4
        `,
    )
        .bind(input.workspaceId, input.roomId, input.surface, relativePath)
        .first<{ objectKey: string; kind: string; byteLength: number | null }>()
    if (existing?.kind === 'directory') {
        throw new Error(`File path is already a directory: ${relativePath}`)
    }
    await assertHostedQuotaAllowed({
        env: input.env,
        workspaceId: input.workspaceId,
        roomId: input.roomId,
        action: 'runtime_file_sync',
        amount: {
            bytes: input.content.byteLength,
            storageBytes: Math.max(0, input.content.byteLength - (existing?.byteLength ?? 0)),
        },
    })
    const persisted = await persistHostedRoomFileContent({
        env: input.env,
        workspaceId: input.workspaceId,
        roomId: input.roomId,
        surface: input.surface,
        relativePath,
        content: input.content,
        mode: 'upsert',
    })
    if (existing?.objectKey && existing.objectKey !== persisted.objectKey) {
        await deleteHostedRoomFileObjectBestEffort({
            env: input.env,
            objectKey: existing.objectKey,
            context: 'Hosted stale file object cleanup failed',
        })
    }
    return persisted.entry
}

export async function deleteHostedRoomIndexedFile(input: {
    env: AgentRoomHostedEnv
    workspaceId: string
    roomId: string
    surface: RoomFileSurface
    relativePath: string
}): Promise<void> {
    const relativePath = normalizeRoomFileRelativePath(input.relativePath)
    const row = await input.env.AGENT_ROOM_DB.prepare(
        `
            SELECT object_key AS objectKey,
                   kind
            FROM hosted_room_file_index
            WHERE workspace_id = ?1
              AND room_id = ?2
              AND surface = ?3
              AND relative_path = ?4
        `,
    )
        .bind(input.workspaceId, input.roomId, input.surface, relativePath)
        .first<{ objectKey: string; kind: string }>()
    if (!row) {
        return
    }
    if (row.kind !== 'file') {
        throw new Error(`Indexed path is not a file: ${relativePath}`)
    }
    const result = await input.env.AGENT_ROOM_DB.prepare(
        `
            DELETE FROM hosted_room_file_index
            WHERE workspace_id = ?1
              AND room_id = ?2
              AND surface = ?3
              AND relative_path = ?4
              AND object_key = ?5
              AND kind = 'file'
        `,
    )
        .bind(input.workspaceId, input.roomId, input.surface, relativePath, row.objectKey)
        .run()
    if (!result.meta || result.meta.changes < 1) {
        throw new Error(`Indexed file changed before delete: ${relativePath}`)
    }
    await deleteHostedRoomFileObjectBestEffort({
        env: input.env,
        objectKey: row.objectKey,
        context: 'Hosted file object cleanup failed',
    })
}
