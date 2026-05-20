import { describe, expect, it } from 'vitest'

import type { RoomSessionArtifact } from '#/lib/room-execution-types'
import {
    artifactPanelStatesEqual,
    artifactPanelDefaultWidth,
    artifactPanelMaxWidth,
    artifactPanelMinWidth,
    defaultArtifactPanelState,
    patchArtifactPanelState,
    resolveSelectedArtifact,
    resolveSelectedArtifactId,
    sessionArtifactStateKey,
} from './session-artifact-state'

describe('session artifact state', () => {
    it('uses a stable room/session key', () => {
        expect(sessionArtifactStateKey('room-1', 'session-1')).toBe('room-1:session-1')
    })

    it('has a closed empty default panel state', () => {
        expect(defaultArtifactPanelState()).toEqual({
            open: false,
            loaded: false,
            autoOpened: false,
            selectedArtifactId: null,
            width: artifactPanelDefaultWidth,
        })
    })

    it('clamps persisted desktop width to stable panel bounds', () => {
        const current = defaultArtifactPanelState()

        expect(patchArtifactPanelState(current, { width: 100 }).width).toBe(artifactPanelMinWidth)
        expect(patchArtifactPanelState(current, { width: 900 }).width).toBe(artifactPanelMaxWidth)
        expect(patchArtifactPanelState(current, { width: Number.NaN }).width).toBe(
            artifactPanelDefaultWidth,
        )
    })

    it('preserves a valid explicit artifact selection', () => {
        const artifacts = [artifact('artifact-1'), artifact('artifact-2')]

        expect(resolveSelectedArtifact(artifacts, 'artifact-2')).toBe(artifacts[1])
        expect(resolveSelectedArtifactId(artifacts, 'artifact-2')).toBe('artifact-2')
    })

    it('falls back to the first artifact when selection is missing or stale', () => {
        const artifacts = [artifact('artifact-1'), artifact('artifact-2')]

        expect(resolveSelectedArtifact(artifacts, null)).toBe(artifacts[0])
        expect(resolveSelectedArtifactId(artifacts, 'deleted-artifact')).toBe('artifact-1')
    })

    it('does not clear persisted selection during a transient empty artifact list', () => {
        const artifacts = [artifact('artifact-1'), artifact('artifact-2')]
        const state = patchArtifactPanelState(defaultArtifactPanelState(), {
            open: true,
            loaded: true,
            selectedArtifactId: 'artifact-2',
        })

        expect(resolveSelectedArtifactId([], state.selectedArtifactId)).toBeNull()
        expect(state.selectedArtifactId).toBe('artifact-2')
        expect(resolveSelectedArtifactId(artifacts, state.selectedArtifactId)).toBe('artifact-2')
    })

    it('detects no-op panel state patches', () => {
        const current = patchArtifactPanelState(defaultArtifactPanelState(), {
            loaded: true,
            selectedArtifactId: 'artifact-1',
        })
        const same = patchArtifactPanelState(current, {
            selectedArtifactId: 'artifact-1',
        })
        const changed = patchArtifactPanelState(current, {
            selectedArtifactId: 'artifact-2',
        })

        expect(artifactPanelStatesEqual(current, same)).toBe(true)
        expect(artifactPanelStatesEqual(current, changed)).toBe(false)
    })
})

function artifact(id: string): RoomSessionArtifact {
    return {
        id,
        name: `${id}.txt`,
        surface: 'workspace',
        relativePath: `${id}.txt`,
        kind: 'created',
        source: 'test',
        toolName: null,
        operation: null,
        artifactId: null,
        byteLength: 1,
        timestamp: 1,
        messageId: null,
    }
}
