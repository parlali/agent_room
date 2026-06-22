import { describe, expect, it } from 'vitest'
import {
    hostedWorkspaceFileKey,
    hostedWorkspacePrefix,
    hostedWorkspaceSnapshotKey,
} from './workspace-storage'

describe('hosted workspace R2 keys', () => {
    it('scopes room files under workspace and room prefixes', () => {
        expect(
            hostedWorkspaceFileKey({
                workspaceId: 'workspace_1',
                roomId: 'room_1',
                relativePath: '/src/index.ts',
            }),
        ).toBe('workspaces/workspace_1/rooms/room_1/files/src/index.ts')
    })

    it('encodes unsafe path characters without changing the storage scope', () => {
        expect(
            hostedWorkspaceFileKey({
                workspaceId: 'workspace_1',
                roomId: 'room_1',
                relativePath: 'notes/hello world.md',
            }),
        ).toBe('workspaces/workspace_1/rooms/room_1/files/notes/hello%20world.md')
    })

    it('rejects relative path traversal', () => {
        expect(() =>
            hostedWorkspaceFileKey({
                workspaceId: 'workspace_1',
                roomId: 'room_1',
                relativePath: '../secret.txt',
            }),
        ).toThrow(/relative segments/)
    })

    it('rejects unsafe workspace identifiers', () => {
        expect(() =>
            hostedWorkspacePrefix({
                workspaceId: 'workspace/1',
                roomId: 'room_1',
            }),
        ).toThrow(/workspaceId/)
    })

    it('builds snapshot keys under the same room scope', () => {
        expect(
            hostedWorkspaceSnapshotKey({
                workspaceId: 'workspace_1',
                roomId: 'room_1',
                snapshotId: 'snapshot_1',
            }),
        ).toBe('workspaces/workspace_1/rooms/room_1/snapshots/snapshot_1.tar.zst')
    })
})
