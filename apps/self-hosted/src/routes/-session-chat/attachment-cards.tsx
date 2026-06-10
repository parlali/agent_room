import { FileIcon, FileImageIcon, FileTextIcon, XIcon } from 'lucide-react'

import { Button } from '#/components/ui/button'
import { formatBytes } from '#/domain/format'
import { roomFilePreviewUrl } from '#/domain/room-file-links'
import type { RoomAttachment } from '#/domain/room-attachments'
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
    const image = isImageAttachment(attachment.name)
    const Icon = image ? FileImageIcon : isTextAttachment(attachment.name) ? FileTextIcon : FileIcon
    const size =
        attachment.byteLength === null ? attachment.sizeLabel : formatBytes(attachment.byteLength)

    return (
        <div
            className={cn(
                'relative shrink-0 overflow-hidden rounded-xl border border-border bg-card text-card-foreground shadow-sm',
                compact ? 'w-28' : 'w-32',
            )}
        >
            <div
                className={cn(
                    'flex items-center justify-center bg-muted',
                    compact ? 'h-20' : 'h-24',
                )}
            >
                {image ? (
                    <img
                        src={roomFilePreviewUrl(roomId, attachment)}
                        alt=""
                        className="h-full w-full object-cover"
                        loading="lazy"
                    />
                ) : (
                    <Icon className="size-8 text-muted-foreground" />
                )}
            </div>
            <div className="space-y-0.5 px-2 py-1.5">
                <div className="truncate text-xs font-medium">{attachment.name}</div>
                <div className="truncate text-[0.6875rem] text-muted-foreground">
                    {[fileExtension(attachment.name), size].filter(Boolean).join(' - ')}
                </div>
            </div>
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
        </div>
    )
}

function fileExtension(name: string): string | null {
    const index = name.lastIndexOf('.')
    if (index <= 0 || index === name.length - 1) return null
    return name.slice(index + 1).toUpperCase()
}

function isImageAttachment(name: string): boolean {
    const ext = fileExtension(name)?.toLowerCase()
    return ext === 'png' || ext === 'jpg' || ext === 'jpeg' || ext === 'gif' || ext === 'webp'
}

function isTextAttachment(name: string): boolean {
    const ext = fileExtension(name)?.toLowerCase()
    return (
        ext === 'txt' ||
        ext === 'md' ||
        ext === 'json' ||
        ext === 'csv' ||
        ext === 'log' ||
        ext === 'ts' ||
        ext === 'tsx' ||
        ext === 'js' ||
        ext === 'py'
    )
}
