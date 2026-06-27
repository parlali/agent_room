import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { XIcon } from 'lucide-react'

import { Button } from '#/components/ui/button'
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from '#/components/ui/dialog'
import { RoomFileMetadata, RoomFilePreviewContent } from '#/components/room-files/file-preview'
import { RoomFileDownloadMenu } from '#/components/room-files/file-download-menu'
import { roomFileEntryIcon } from '#/components/room-files/file-kinds'
import { classifyRoomFileKind, fileExtensionLabel, roomFileSurfaceLabel } from '#/domain/file-kinds'
import { formatBytes } from '#/domain/format'
import { roomFileDownloadUrl, roomFilePreviewUrl } from '#/domain/room-file-links'
import type { RoomAttachment } from '#/domain/room-attachments'
import type { RoomFileEntry, RoomFilePreview } from '#/domain/room-file-types'
import { roomQueryKey, roomQueryPolicy } from '#/lib/room-query-keys'
import { readRoomFileServer } from '#/routes/-room-runtime-server'
import { cn } from '#/lib/utils'

export function AttachmentCards({
    roomId,
    attachments,
    onRemove,
    compact = false,
    align = 'start',
}: {
    roomId: string
    attachments: RoomAttachment[]
    onRemove?: (id: string) => void
    compact?: boolean
    align?: 'start' | 'end'
}) {
    if (attachments.length === 0) return null

    return (
        <div
            className={cn(
                'flex max-w-full gap-2 overflow-x-auto',
                align === 'end' ? 'justify-end' : 'justify-start',
                compact ? 'pb-1' : 'pb-2',
            )}
        >
            {attachments.map((attachment) => (
                <AttachmentCard
                    key={attachment.id}
                    roomId={roomId}
                    attachment={attachment}
                    onRemove={onRemove}
                    compact={compact}
                />
            ))}
        </div>
    )
}

function attachmentToFileEntry(attachment: RoomAttachment): RoomFileEntry {
    return {
        name: attachment.name,
        relativePath: attachment.relativePath,
        surface: attachment.surface,
        kind: 'file',
        byteLength: attachment.byteLength,
        updatedAt: null,
    }
}

function AttachmentCard({
    roomId,
    attachment,
    onRemove,
    compact,
}: {
    roomId: string
    attachment: RoomAttachment
    onRemove?: (id: string) => void
    compact: boolean
}) {
    const [open, setOpen] = useState(false)
    const isImage = classifyRoomFileKind(attachment.name, 'file') === 'image'
    const Icon = roomFileEntryIcon({ name: attachment.name, kind: 'file' })
    const size =
        attachment.byteLength === null ? attachment.sizeLabel : formatBytes(attachment.byteLength)

    return (
        <div
            className={cn(
                'relative shrink-0 overflow-hidden rounded-xl border border-border bg-card text-card-foreground shadow-sm',
                compact ? 'w-28' : 'w-32',
            )}
        >
            <button
                type="button"
                onClick={() => setOpen(true)}
                aria-label={`Preview ${attachment.name}`}
                className="block w-full text-left transition-colors hover:bg-muted/40"
            >
                <div
                    className={cn(
                        'flex items-center justify-center bg-muted',
                        compact ? 'h-20' : 'h-24',
                    )}
                >
                    {isImage ? (
                        <AttachmentThumbnail roomId={roomId} attachment={attachment} Icon={Icon} />
                    ) : (
                        <Icon className="size-8 text-muted-foreground" />
                    )}
                </div>
                <div className="space-y-0.5 px-2 py-1.5">
                    <div className="truncate text-xs font-medium">{attachment.name}</div>
                    <div className="truncate text-[0.6875rem] text-muted-foreground">
                        {[fileExtensionLabel(attachment.name), size].filter(Boolean).join(' - ')}
                    </div>
                </div>
            </button>
            {onRemove ? (
                <Button
                    type="button"
                    variant="secondary"
                    size="icon-xs"
                    className="absolute right-1.5 top-1.5 rounded-full bg-background/95 text-foreground shadow-sm"
                    aria-label={`Remove ${attachment.name}`}
                    onClick={() => onRemove(attachment.id)}
                >
                    <XIcon />
                </Button>
            ) : null}
            <AttachmentPreviewDialog
                roomId={roomId}
                attachment={attachment}
                open={open}
                onOpenChange={setOpen}
            />
        </div>
    )
}

function AttachmentThumbnail({
    roomId,
    attachment,
    Icon,
}: {
    roomId: string
    attachment: RoomAttachment
    Icon: ReturnType<typeof roomFileEntryIcon>
}) {
    const [failed, setFailed] = useState(false)
    if (failed) {
        return <Icon className="size-8 text-muted-foreground" />
    }
    return (
        <img
            src={roomFilePreviewUrl(roomId, attachment)}
            alt=""
            className="h-full w-full object-cover"
            loading="lazy"
            onError={() => setFailed(true)}
        />
    )
}

function AttachmentPreviewDialog({
    roomId,
    attachment,
    open,
    onOpenChange,
}: {
    roomId: string
    attachment: RoomAttachment
    open: boolean
    onOpenChange: (open: boolean) => void
}) {
    const entry = attachmentToFileEntry(attachment)
    const previewQuery = useQuery({
        queryKey: roomQueryKey.roomFilePreview(roomId, entry.surface, entry.relativePath),
        queryFn: () =>
            readRoomFileServer({
                data: {
                    roomId,
                    surface: entry.surface,
                    relativePath: entry.relativePath,
                },
            }),
        enabled: open,
        staleTime: roomQueryPolicy.coldStaleMs,
    })
    const preview = previewQuery.data as RoomFilePreview | undefined
    const previewUrl = roomFilePreviewUrl(roomId, entry)
    const downloadUrl = roomFileDownloadUrl(roomId, entry)

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="grid max-h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] max-w-3xl grid-rows-[auto_auto_minmax(0,1fr)] gap-3 p-4">
                <div className="flex min-w-0 items-start justify-between gap-3 pr-8">
                    <DialogHeader className="min-w-0">
                        <DialogTitle className="truncate">{attachment.name}</DialogTitle>
                        <DialogDescription className="truncate">
                            {roomFileSurfaceLabel(entry.surface)} / {entry.relativePath}
                        </DialogDescription>
                    </DialogHeader>
                    <RoomFileDownloadMenu
                        roomId={roomId}
                        entry={entry}
                        preview={preview}
                        variant="outline"
                    />
                </div>
                <RoomFileMetadata entry={entry} />
                <div className="min-h-0">
                    <RoomFilePreviewContent
                        entry={entry}
                        preview={preview}
                        previewUrl={previewUrl}
                        downloadUrl={downloadUrl}
                        loading={previewQuery.isLoading}
                        error={previewQuery.error}
                        onRetry={() => void previewQuery.refetch()}
                        displayMode="fill"
                    />
                </div>
            </DialogContent>
        </Dialog>
    )
}
