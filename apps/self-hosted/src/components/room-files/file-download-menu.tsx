import type { ComponentProps } from 'react'
import { ChevronDownIcon, DownloadIcon, FileDownIcon } from 'lucide-react'

import { Button } from '#/components/ui/button'
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from '#/components/ui/dropdown-menu'
import { roomFileEntryDownloadUrl, roomFileEntryPreviewDownloadUrl } from '#/domain/room-file-links'
import type { RoomFileEntry, RoomFilePreview } from '#/domain/room-file-types'

type ButtonProps = ComponentProps<typeof Button>

export function RoomFileDownloadMenu({
    roomId,
    entry,
    preview,
    variant = 'ghost',
    size = 'sm',
}: {
    roomId: string
    entry: RoomFileEntry
    preview: RoomFilePreview | undefined
    variant?: ButtonProps['variant']
    size?: ButtonProps['size']
}) {
    const originalUrl = roomFileEntryDownloadUrl(roomId, entry)
    const previewUrl = roomFileEntryPreviewDownloadUrl(roomId, entry)
    const hasGeneratedPdfPreview = preview?.kind === 'pdf' && preview.generated

    if (!hasGeneratedPdfPreview) {
        return (
            <Button asChild variant={variant} size={size}>
                <a href={originalUrl} download={entry.name}>
                    <DownloadIcon />
                    Download
                </a>
            </Button>
        )
    }

    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button type="button" variant={variant} size={size}>
                    <DownloadIcon />
                    Download
                    <ChevronDownIcon data-icon="inline-end" />
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
                <DropdownMenuItem asChild>
                    <a href={originalUrl} download={entry.name}>
                        <DownloadIcon />
                        Original file
                    </a>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                    <a href={previewUrl} download>
                        <FileDownIcon />
                        PDF preview
                    </a>
                </DropdownMenuItem>
            </DropdownMenuContent>
        </DropdownMenu>
    )
}
