import type { ArtifactIndexRecord, JsonValue } from '#/domain/domain-types'
import { artifactIndex } from '../schema'
import { mapArtifact } from './row-mappers'
import { createDatabaseId, excluded, nowDate, repositoryDatabase } from './repository-utils'

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
        const db = await repositoryDatabase()
        const [row] = await db
            .insert(artifactIndex)
            .values({
                id: createDatabaseId(),
                roomId: input.roomId,
                artifactId: input.artifactId,
                kind: input.kind,
                sha256: input.sha256,
                byteLength: input.byteLength,
                mediaType: input.mediaType,
                manifestPath: input.manifestPath,
                source: input.source,
                provenance: input.provenance,
                createdBy: input.createdBy,
                createdAt: nowDate(),
            })
            .onConflictDoUpdate({
                target: [artifactIndex.roomId, artifactIndex.artifactId],
                set: {
                    kind: excluded('kind'),
                    sha256: excluded('sha256'),
                    byteLength: excluded('byte_length'),
                    mediaType: excluded('media_type'),
                    manifestPath: excluded('manifest_path'),
                    source: excluded('source'),
                    provenance: excluded('provenance'),
                    createdBy: excluded('created_by'),
                },
            })
            .returning()
        return mapArtifact(row)
    },
}
