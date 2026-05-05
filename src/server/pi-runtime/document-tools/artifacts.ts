import type { DocumentToolContext } from './types'
import { mediaTypeFor } from './paths'
import { promoteRuntimeArtifact, sha256Buffer } from '../runtime-artifacts'

export { sha256Buffer }

export async function promoteArtifact(
    ctx: DocumentToolContext,
    path: string,
): Promise<{
    artifactId: string
    sha256: string
    byteLength: number
}> {
    return promoteRuntimeArtifact({
        config: ctx.config,
        path,
        mediaType: mediaTypeFor(path),
    })
}
