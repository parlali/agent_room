import type { ArtifactIndexRecord, JsonValue } from '../../domain/types'
import { sql } from '../client'
import { mapArtifact } from './row-mappers'

export const artifactIndexRepository = {
    async upsertArtifact(input: {
        roomId: string
        artifactId: string
        kind: ArtifactIndexRecord['kind']
        sha256: string
        byteLength: number
        mediaType: string
        manifestPath: string
        source: JsonValue
        provenance: JsonValue
        createdBy: string
    }): Promise<ArtifactIndexRecord> {
        const rows = await sql`
            INSERT INTO artifact_index (
                room_id,
                artifact_id,
                kind,
                sha256,
                byte_length,
                media_type,
                manifest_path,
                source,
                provenance,
                created_by
            )
            VALUES (
                ${input.roomId},
                ${input.artifactId},
                ${input.kind},
                ${input.sha256},
                ${input.byteLength},
                ${input.mediaType},
                ${input.manifestPath},
                ${sql.json(input.source)},
                ${sql.json(input.provenance)},
                ${input.createdBy}
            )
            ON CONFLICT (room_id, artifact_id)
            DO UPDATE SET
                kind = excluded.kind,
                sha256 = excluded.sha256,
                byte_length = excluded.byte_length,
                media_type = excluded.media_type,
                manifest_path = excluded.manifest_path,
                source = excluded.source,
                provenance = excluded.provenance,
                created_by = excluded.created_by
            RETURNING *
        `
        return mapArtifact(rows[0] as Record<string, unknown>)
    },
}
