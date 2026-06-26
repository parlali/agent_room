import {
    FileIcon,
    FileImageIcon,
    FileSpreadsheetIcon,
    FileTextIcon,
    FileTypeIcon,
    FolderIcon,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

import { classifyRoomFileKind, type RoomFileKind } from '#/domain/file-kinds'
import type { RoomFileEntry } from '#/domain/room-file-types'

export * from '#/domain/file-kinds'

const kindIcons: Record<RoomFileKind, LucideIcon> = {
    directory: FolderIcon,
    image: FileImageIcon,
    text: FileTextIcon,
    pdf: FileTypeIcon,
    office: FileSpreadsheetIcon,
    binary: FileIcon,
}

export function roomFileKindIcon(name: string, kind: 'file' | 'directory'): LucideIcon {
    return kindIcons[classifyRoomFileKind(name, kind)]
}

export function roomFileEntryIcon(entry: Pick<RoomFileEntry, 'name' | 'kind'>): LucideIcon {
    return roomFileKindIcon(entry.name, entry.kind)
}
