import type { RoomSessionArtifact } from '#/lib/room-execution-types'

export interface SessionArtifactPanelState {
    open: boolean
    loaded: boolean
    autoOpened: boolean
    selectedArtifactId: string | null
    width: number
}

export const artifactPanelMinWidth = 320
export const artifactPanelMaxWidth = 560
export const artifactPanelDefaultWidth = 384

export function defaultArtifactPanelState(): SessionArtifactPanelState {
    return {
        open: false,
        loaded: false,
        autoOpened: false,
        selectedArtifactId: null,
        width: artifactPanelDefaultWidth,
    }
}

export function sessionArtifactStateKey(roomId: string, sessionKey: string): string {
    return `${roomId}:${sessionKey}`
}

export function resolveSelectedArtifact(
    artifacts: RoomSessionArtifact[],
    selectedArtifactId: string | null,
): RoomSessionArtifact | null {
    if (artifacts.length === 0) return null
    if (selectedArtifactId) {
        const selectedArtifact = artifacts.find((artifact) => artifact.id === selectedArtifactId)
        if (selectedArtifact) return selectedArtifact
    }
    return artifacts[0] ?? null
}

export function resolveSelectedArtifactId(
    artifacts: RoomSessionArtifact[],
    selectedArtifactId: string | null,
): string | null {
    return resolveSelectedArtifact(artifacts, selectedArtifactId)?.id ?? null
}

export function patchArtifactPanelState(
    current: SessionArtifactPanelState,
    patch: Partial<SessionArtifactPanelState>,
): SessionArtifactPanelState {
    const width =
        typeof patch.width === 'number' ? clampArtifactPanelWidth(patch.width) : current.width
    return {
        ...current,
        ...patch,
        width,
    }
}

export function clampArtifactPanelWidth(width: number): number {
    if (!Number.isFinite(width)) return artifactPanelDefaultWidth
    return Math.min(artifactPanelMaxWidth, Math.max(artifactPanelMinWidth, Math.round(width)))
}

export function artifactPanelStatesEqual(
    left: SessionArtifactPanelState,
    right: SessionArtifactPanelState,
): boolean {
    return (
        left.open === right.open &&
        left.loaded === right.loaded &&
        left.autoOpened === right.autoOpened &&
        left.selectedArtifactId === right.selectedArtifactId &&
        left.width === right.width
    )
}
