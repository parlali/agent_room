export type RoomFileSurface = 'workspace' | 'store'

export interface RoomFileProvenance {
    sessionKey: string | null
    runId: string | null
    messageId: string | null
}

export interface RoomFileEntry {
    name: string
    relativePath: string
    surface: RoomFileSurface
    kind: 'file' | 'directory'
    byteLength: number | null
    updatedAt: string | null
    producedBy?: RoomFileProvenance | null
}

export interface RoomDirectoryListing {
    surface: RoomFileSurface
    relativePath: string
    parentPath: string | null
    breadcrumbs: Array<{
        name: string
        relativePath: string
    }>
    entries: RoomFileEntry[]
}

export interface RoomFileTreeNode {
    name: string
    relativePath: string
    surface: RoomFileSurface
    children: RoomFileTreeNode[]
    truncated: boolean
}

export interface RoomFileTree {
    roots: RoomFileTreeNode[]
}

export type RoomFilePreview =
    | {
          kind: 'text'
          name: string
          relativePath: string
          surface: RoomFileSurface
          mediaType: string
          encoding: 'utf8'
          content: string
          byteLength: number
          truncated: boolean
          generated: false
      }
    | {
          kind: 'image' | 'pdf'
          name: string
          relativePath: string
          surface: RoomFileSurface
          mediaType: string
          byteLength: number
          truncated: false
          generated: boolean
      }
    | {
          kind: 'unsupported'
          name: string
          relativePath: string
          surface: RoomFileSurface
          mediaType: string
          byteLength: number
          reason: string
      }

export interface RoomFilePreviewAsset {
    name: string
    relativePath: string
    surface: RoomFileSurface
    mediaType: string
    byteLength: number
    content: Buffer
    generated: boolean
}

export interface RoomFileResolvedAsset {
    name: string
    relativePath: string
    surface: RoomFileSurface
    mediaType: string
    byteLength: number
    path: string
    generated: boolean
}
