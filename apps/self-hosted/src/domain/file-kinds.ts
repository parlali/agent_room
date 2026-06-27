import type { RoomFileEntry, RoomFileProvenance, RoomFileSurface } from './room-file-types'
import type { RoomSessionArtifactKind } from './room-execution-types'

export type RoomFileKind = 'directory' | 'image' | 'text' | 'pdf' | 'office' | 'binary'

const imageExtensions = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'avif', 'ico'])

const textExtensions = new Set([
    'txt',
    'md',
    'markdown',
    'json',
    'jsonc',
    'yaml',
    'yml',
    'csv',
    'tsv',
    'log',
    'env',
    'sh',
    'bash',
    'zsh',
    'js',
    'mjs',
    'cjs',
    'ts',
    'tsx',
    'jsx',
    'py',
    'rb',
    'go',
    'rs',
    'java',
    'kt',
    'c',
    'cc',
    'cpp',
    'h',
    'hpp',
    'sql',
    'html',
    'css',
    'scss',
    'less',
    'toml',
    'ini',
    'conf',
    'xml',
])

const officeExtensions = new Set(['doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'odt', 'ods', 'odp'])

export function fileExtension(name: string): string {
    const index = name.lastIndexOf('.')
    if (index <= 0 || index === name.length - 1) return ''
    return name.slice(index + 1).toLowerCase()
}

export function fileExtensionLabel(name: string): string | null {
    const extension = fileExtension(name)
    return extension ? extension.toUpperCase() : null
}

export function classifyRoomFileKind(name: string, kind: 'file' | 'directory'): RoomFileKind {
    if (kind === 'directory') return 'directory'
    const extension = fileExtension(name)
    if (extension === 'pdf') return 'pdf'
    if (imageExtensions.has(extension)) return 'image'
    if (officeExtensions.has(extension)) return 'office'
    if (textExtensions.has(extension)) return 'text'
    return 'binary'
}

export function isOfficeFile(name: string): boolean {
    return officeExtensions.has(fileExtension(name))
}

export function roomFileTypeLabel(entry: Pick<RoomFileEntry, 'name' | 'kind'>): string {
    if (entry.kind === 'directory') return 'Folder'
    return fileExtensionLabel(entry.name) ?? 'File'
}

export function roomFileSurfaceLabel(surface: RoomFileSurface): string {
    return surface === 'workspace' ? 'Agent workspace' : 'Uploads'
}

export function roomFileSurfaceDescription(surface: RoomFileSurface): string {
    return surface === 'workspace'
        ? 'Files the agent works in directly.'
        : 'Files you upload and files the agent shares with you.'
}

export function artifactProvenanceLabel(kind: RoomSessionArtifactKind): string {
    switch (kind) {
        case 'attached':
            return 'You attached'
        case 'created':
            return 'Created by your agent'
        case 'edited':
            return 'Edited by your agent'
        case 'referenced':
            return 'Used by your agent'
    }
}

const attachmentSessionPattern = /^attachments\/([^/]+)\//

export function deriveRoomFileProvenance(
    entry: Pick<RoomFileEntry, 'surface' | 'relativePath' | 'producedBy'>,
): RoomFileProvenance | null {
    if (entry.producedBy) return entry.producedBy
    if (entry.surface !== 'store') return null
    const match = attachmentSessionPattern.exec(entry.relativePath)
    if (!match) return null
    return {
        sessionKey: match[1] ?? null,
        runId: null,
        messageId: null,
    }
}
