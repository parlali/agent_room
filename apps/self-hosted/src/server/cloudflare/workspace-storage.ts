export interface HostedWorkspaceRoomIdentity {
    workspaceId: string
    roomId: string
}

export interface HostedWorkspaceFileKeyInput extends HostedWorkspaceRoomIdentity {
    relativePath: string
}

export interface HostedRoomFileObjectKeyInput extends HostedWorkspaceRoomIdentity {
    surface: 'workspace' | 'store'
    relativePath: string
}

export interface HostedWorkspaceSnapshotKeyInput extends HostedWorkspaceRoomIdentity {
    snapshotId: string
}

export interface HostedRuntimeArtifactKeyInput extends HostedWorkspaceRoomIdentity {
    version: number
    nonce?: string
}

export interface HostedRuntimeStateFileKeyInput extends HostedWorkspaceRoomIdentity {
    relativePath: string
}

export function assertStorageId(value: string, label: string): void {
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(value)) {
        throw new Error(`${label} must contain only letters, numbers, underscores, or hyphens`)
    }
}

function encodePathSegment(segment: string): string {
    if (!segment || segment === '.' || segment === '..') {
        throw new Error('Workspace object paths cannot contain empty or relative segments')
    }
    if (segment.includes('\\') || segment.includes('\u0000')) {
        throw new Error('Workspace object paths cannot contain backslashes or null bytes')
    }
    return encodeURIComponent(segment)
}

export function hostedWorkspacePrefix(input: HostedWorkspaceRoomIdentity): string {
    assertStorageId(input.workspaceId, 'workspaceId')
    assertStorageId(input.roomId, 'roomId')
    return `workspaces/${input.workspaceId}/rooms/${input.roomId}`
}

export function hostedWorkspaceFileKey(input: HostedWorkspaceFileKeyInput): string {
    const relativePath = input.relativePath.replace(/^\/+/, '')
    const encodedPath = relativePath.split('/').map(encodePathSegment).join('/')
    return `${hostedWorkspacePrefix(input)}/files/${encodedPath}`
}

export function hostedRoomFileObjectKey(input: HostedRoomFileObjectKeyInput): string {
    return hostedWorkspaceFileKey({
        workspaceId: input.workspaceId,
        roomId: input.roomId,
        relativePath: `${input.surface}/${input.relativePath}`,
    })
}

export function hostedWorkspaceSnapshotKey(input: HostedWorkspaceSnapshotKeyInput): string {
    assertStorageId(input.snapshotId, 'snapshotId')
    return `${hostedWorkspacePrefix(input)}/snapshots/${input.snapshotId}.tar.zst`
}

export function hostedRuntimeConfigKey(input: HostedRuntimeArtifactKeyInput): string {
    const suffix = input.nonce ? `-${encodePathSegment(input.nonce)}` : ''
    return `${hostedWorkspacePrefix(input)}/runtime/config-v${input.version}${suffix}.json`
}

export function hostedRuntimeTokenKey(input: HostedRuntimeArtifactKeyInput): string {
    const suffix = input.nonce ? `-${encodePathSegment(input.nonce)}` : ''
    return `${hostedWorkspacePrefix(input)}/runtime/token-v${input.version}${suffix}.txt`
}

export function hostedRuntimeBundleKey(input: HostedRuntimeArtifactKeyInput): string {
    const suffix = input.nonce ? `-${encodePathSegment(input.nonce)}` : ''
    return `${hostedWorkspacePrefix(input)}/runtime/bundle-v${input.version}${suffix}.json`
}

export function hostedRuntimeStatePrefix(input: HostedWorkspaceRoomIdentity): string {
    return `${hostedWorkspacePrefix(input)}/runtime/state/`
}

export function hostedRuntimeStateFileKey(input: HostedRuntimeStateFileKeyInput): string {
    const relativePath = input.relativePath.replace(/^\/+/, '')
    const encodedPath = relativePath.split('/').map(encodePathSegment).join('/')
    return `${hostedRuntimeStatePrefix(input)}${encodedPath}`
}
